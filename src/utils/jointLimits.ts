/**
 * Joint limits from a URDF, and the frames of an episode where a joint goes past them. Pure, so the
 * 3D Replay viewer and the dataset-wide scan report the same frames.
 */
import { CHART_CONFIG } from "@/utils/constants";
import {
  autoMatchJoints,
  defaultColumnGroup,
  episodeAngleUnit,
  groupColumnsByPrefix,
  isSpecialJoint,
  toRadians,
  type AngleUnit,
} from "@/utils/jointMapping";
import {
  manifestJointMapping,
  type RobotManifest,
} from "@/utils/robotManifest";

export type UrdfJoint = {
  name: string;
  type: string;
  mimic: boolean;
  lower?: number;
  upper?: number;
};

/** In radians for a revolute joint, metres for a prismatic one. */
export type JointLimit = {
  type: "revolute" | "prismatic";
  lower: number;
  upper: number;
};

/** Inclusive frame range. */
export type FrameRange = { start: number; end: number };

export type JointViolation = {
  joint: string;
  type: JointLimit["type"];
  /** Frames past a limit. */
  frames: number;
  ranges: FrameRange[];
  /** Largest distance past a limit, in the limit's unit. */
  worst: number;
  worstFrame: number;
};

export type LimitReport = {
  totalFrames: number;
  /** Frames where any joint is past a limit. */
  framesOver: number;
  /** Most frames first. */
  joints: JointViolation[];
};

/** Only float rounding (the data is float32): a value on its limit is not past it. */
export const LIMIT_EPSILON = 1e-6;

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`));
  return m ? (m[1] ?? m[2]) : undefined;
}

function num(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

/** The URDF's `<joint>`s. A `<joint>` without a type (a transmission's) is not one. */
export function parseUrdfJoints(xml: string): UrdfJoint[] {
  const text = xml.replace(/<!--[\s\S]*?-->/g, "");
  const joints: UrdfJoint[] = [];
  for (const m of text.matchAll(
    /<joint\b([^>]*?)(?:\/>|>([\s\S]*?)<\/joint>)/g,
  )) {
    const name = attr(m[1], "name");
    const type = attr(m[1], "type");
    if (!name || !type) continue;
    const body = m[2] ?? "";
    const limit = body.match(/<limit\b([^>]*)>/)?.[1];
    joints.push({
      name,
      type,
      mimic: /<mimic\b/.test(body),
      lower: limit ? num(attr(limit, "lower")) : undefined,
      upper: limit ? num(attr(limit, "upper")) : undefined,
    });
  }
  return joints;
}

/** Joints the data drives: not fixed, not following another (mimic). */
export function drivenJointNames(joints: UrdfJoint[]): string[] {
  return joints
    .filter((j) => j.type !== "fixed" && !j.mimic)
    .map((j) => j.name);
}

/** Limits of the driven revolute and prismatic joints that have a range. */
export function jointLimitsOf(joints: UrdfJoint[]): Record<string, JointLimit> {
  const limits: Record<string, JointLimit> = {};
  for (const j of joints) {
    if (j.mimic || (j.type !== "revolute" && j.type !== "prismatic")) continue;
    if (j.lower === undefined || j.upper === undefined || j.lower >= j.upper)
      continue;
    limits[j.name] = { type: j.type, lower: j.lower, upper: j.upper };
  }
  return limits;
}

/** A recorded value in the joint's unit: radians, or metres as recorded for a prismatic joint. */
export function jointValue(
  raw: number,
  type: string | undefined,
  unit: AngleUnit,
): number {
  return type === "prismatic" ? raw : toRadians(raw, unit);
}

/** How far past its limit `value` is; 0 when within it. */
export function overshoot(value: number, limit: JointLimit): number {
  if (value > limit.upper + LIMIT_EPSILON) return value - limit.upper;
  if (value < limit.lower - LIMIT_EPSILON) return limit.lower - value;
  return 0;
}

/** Frames of `rows` where a mapped joint is past its limit. */
export function findLimitViolations(
  rows: Record<string, number>[],
  mapping: Record<string, string>,
  limits: Record<string, JointLimit>,
  unit: AngleUnit,
): LimitReport {
  const over = new Uint8Array(rows.length);
  const joints: JointViolation[] = [];
  for (const [joint, limit] of Object.entries(limits)) {
    const col = mapping[joint];
    if (!col || isSpecialJoint(joint)) continue;
    const v: JointViolation = {
      joint,
      type: limit.type,
      frames: 0,
      ranges: [],
      worst: 0,
      worstFrame: -1,
    };
    for (let f = 0; f < rows.length; f++) {
      const raw = rows[f][col];
      if (!Number.isFinite(raw)) continue;
      const d = overshoot(jointValue(raw, limit.type, unit), limit);
      if (d === 0) continue;
      v.frames++;
      over[f] = 1;
      if (d > v.worst) {
        v.worst = d;
        v.worstFrame = f;
      }
      const last = v.ranges[v.ranges.length - 1];
      if (last && last.end === f - 1) last.end = f;
      else v.ranges.push({ start: f, end: f });
    }
    if (v.frames > 0) joints.push(v);
  }
  joints.sort((a, b) => b.frames - a.frames || b.worst - a.worst);
  let framesOver = 0;
  for (const o of over) framesOver += o;
  return { totalFrames: rows.length, framesOver, joints };
}

/** The joints past a limit at `frame`. */
export function jointsOverAt(report: LimitReport, frame: number): Set<string> {
  const out = new Set<string>();
  for (const v of report.joints) {
    if (v.ranges.some((r) => r.start <= frame && frame <= r.end))
      out.add(v.joint);
  }
  return out;
}

/** The frames where any joint is past a limit, as merged ranges. */
export function framesOverRanges(report: LimitReport): FrameRange[] {
  const all = report.joints
    .flatMap((v) => v.ranges)
    .sort((a, b) => a.start - b.start);
  const merged: FrameRange[] = [];
  for (const r of all) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + 1) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}

/**
 * An episode's report, its joints mapped the way the 3D Replay viewer maps them by default: from
 * the state feature (else the action), by name and then by the manifest.
 */
export function episodeLimitReport(
  rows: Record<string, number>[],
  urdfJoints: UrdfJoint[],
  manifest: RobotManifest,
): LimitReport {
  if (rows.length === 0) return { totalFrames: 0, framesOver: 0, joints: [] };
  const groups = groupColumnsByPrefix(Object.keys(rows[0]));
  const columns = groups[defaultColumnGroup(Object.keys(groups))] ?? [];
  const names = drivenJointNames(urdfJoints);
  const mapping = {
    ...autoMatchJoints(names, columns),
    ...manifestJointMapping(
      manifest,
      columns,
      CHART_CONFIG.SERIES_NAME_DELIMITER,
    ),
  };
  const types = new Map(urdfJoints.map((j) => [j.name, j.type]));
  const unit = episodeAngleUnit(
    rows,
    mapping,
    names,
    (j) => types.get(j) === "prismatic",
  );
  return findLimitViolations(rows, mapping, jointLimitsOf(urdfJoints), unit);
}

/** A distance past a limit, in degrees or millimetres. */
export function formatOvershoot(
  value: number,
  type: JointLimit["type"],
): string {
  const shown = type === "prismatic" ? value * 1000 : (value * 180) / Math.PI;
  /// A small overshoot keeps two significant digits rather than reading 0.0.
  const text = shown < 1 ? shown.toPrecision(2) : shown.toFixed(1);
  return type === "prismatic" ? `${text} mm` : `${text}°`;
}
