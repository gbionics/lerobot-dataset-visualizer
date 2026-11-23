/**
 * How a robot's joints are read from a dataset: which columns feed which joint, and the unit the
 * angles are in. Shared by the 3D Replay viewer and the dataset-wide joint-limit scan, so both read
 * an episode the same way.
 */
import { CHART_CONFIG } from "@/utils/constants";

const SERIES_DELIM = CHART_CONFIG.SERIES_NAME_DELIMITER;
const DEG2RAD = Math.PI / 180;

/// The Inspire hands' motors: a finger's proximal joint, or the thumb's yaw or pitch. The other
/// finger joints follow them (mimic joints).
export const INSPIRE_JOINT =
  /^([lr])_(index|middle|ring|pinky|thumb)_proximal(?:_(yaw|pitch))?_joint$/i;

/// The BrainCo hands' motors: a finger's proximal joint, or the thumb's metacarpal or proximal
/// joint. The distal joints follow them (mimic joints).
export const BRAINCO_JOINT =
  /^(left|right)_(?:(index|middle|ring|pinky)_proximal|thumb_(metacarpal|proximal))_joint$/i;

// Detect unit: servo ticks (0-4096), degrees (>6.28), or radians
export type AngleUnit = "ticks" | "degrees" | "radians";

/**
 * Decided once for the episode, from the largest value its joints take. Decided frame by frame, a
 * frame whose joints all happened to sit near zero read degrees as radians, and the arm jumped.
 */
export function detectAngleUnit(maxAbs: number): AngleUnit {
  if (maxAbs > 360) return "ticks";
  if (maxAbs > 6.3) return "degrees";
  return "radians";
}

export function toRadians(value: number, unit: AngleUnit): number {
  if (unit === "ticks") return ((value - 2048) / 2048) * Math.PI;
  if (unit === "degrees") return value * DEG2RAD;
  return value;
}

/** Joints set by their own rules, not read as angles. */
export function isSpecialJoint(joint: string): boolean {
  return (
    joint.toLowerCase().includes("finger_joint1") ||
    INSPIRE_JOINT.test(joint) ||
    BRAINCO_JOINT.test(joint) ||
    joint.includes("_dex1_finger_joint_")
  );
}

export function groupColumnsByPrefix(keys: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const key of keys) {
    if (key === "timestamp") continue;
    const parts = key.split(SERIES_DELIM);
    const feature = parts.length > 1 ? parts[0].trim() : "other";
    /// Features split under observation.state or action (Unitree's left_arm, lower_body...) are one
    /// source, so a robot's joints map from all of them.
    const prefix =
      feature.match(/^(observation\.state|action)\./)?.[1] ?? feature;
    if (!groups[prefix]) groups[prefix] = [];
    groups[prefix].push(key);
  }
  return groups;
}

// Unitree G1 SDK column suffix → joint name. Unitree's own datasets leave out the `.q`.
const G1_SDK_TO_JOINT: Record<string, string> = {
  "klefthippitch.q": "left_hip_pitch_joint",
  "klefthiproll.q": "left_hip_roll_joint",
  "klefthipyaw.q": "left_hip_yaw_joint",
  "kleftknee.q": "left_knee_joint",
  "kleftanklepitch.q": "left_ankle_pitch_joint",
  "kleftankleroll.q": "left_ankle_roll_joint",
  "krighthippitch.q": "right_hip_pitch_joint",
  "krighthiproll.q": "right_hip_roll_joint",
  "krighthipyaw.q": "right_hip_yaw_joint",
  "krightknee.q": "right_knee_joint",
  "krightanklepitch.q": "right_ankle_pitch_joint",
  "krightankleroll.q": "right_ankle_roll_joint",
  "kwaistyaw.q": "waist_yaw_joint",
  "kwaistroll.q": "waist_roll_joint",
  "kwaistpitch.q": "waist_pitch_joint",
  "kleftshoulderpitch.q": "left_shoulder_pitch_joint",
  "kleftshoulderroll.q": "left_shoulder_roll_joint",
  "kleftshoulderyaw.q": "left_shoulder_yaw_joint",
  "kleftelbow.q": "left_elbow_joint",
  "kleftwristroll.q": "left_wrist_roll_joint",
  "kleftwristpitch.q": "left_wrist_pitch_joint",
  "kleftwristyaw.q": "left_wrist_yaw_joint",
  "krightshoulderpitch.q": "right_shoulder_pitch_joint",
  "krightshoulderroll.q": "right_shoulder_roll_joint",
  "krightshoulderyaw.q": "right_shoulder_yaw_joint",
  "krightelbow.q": "right_elbow_joint",
  "krightwristroll.q": "right_wrist_roll_joint",
  "krightwristpitch.q": "right_wrist_pitch_joint",
  "krightwristyaw.q": "right_wrist_yaw_joint",
  "klefthandthumb0.q": "left_hand_thumb_0_joint",
  "klefthandthumb1.q": "left_hand_thumb_1_joint",
  "klefthandthumb2.q": "left_hand_thumb_2_joint",
  "klefthandmiddle0.q": "left_hand_middle_0_joint",
  "klefthandmiddle1.q": "left_hand_middle_1_joint",
  "klefthandindex0.q": "left_hand_index_0_joint",
  "klefthandindex1.q": "left_hand_index_1_joint",
  "krighthandthumb0.q": "right_hand_thumb_0_joint",
  "krighthandthumb1.q": "right_hand_thumb_1_joint",
  "krighthandthumb2.q": "right_hand_thumb_2_joint",
  "krighthandmiddle0.q": "right_hand_middle_0_joint",
  "krighthandmiddle1.q": "right_hand_middle_1_joint",
  "krighthandindex0.q": "right_hand_index_0_joint",
  "krighthandindex1.q": "right_hand_index_1_joint",
};
/// The body's 29 joints, in Unitree's motor order.
const G1_BODY_JOINTS = Object.values(G1_SDK_TO_JOINT).slice(0, 29);
/// Unitree's whole-body (SMPL) datasets record each hand's six motors as `hand_state | finger_0` to
/// `finger_5` (left), then `finger_6` to `finger_11` (right), in an order that depends on the hand.
const INSPIRE_FINGERS = [
  "index",
  "middle",
  "ring",
  "little",
  "thumb_oc",
  "thumb_lat",
];
const BRAINCO_FINGERS = [
  "thumb_oc",
  "thumb_lat",
  "index",
  "middle",
  "ring",
  "little",
];

export function autoMatchJoints(
  jointNames: string[],
  columnKeys: string[],
): Record<string, string> {
  const mapping: Record<string, string> = {};
  const suffixes = columnKeys.map((k) =>
    (k.split(SERIES_DELIM).pop()?.trim() ?? k).toLowerCase(),
  );

  /// A side named by the feature rather than the column (`left_arm | shoulder_pitch`) joins the name.
  const sided = columnKeys.map((k, i) => {
    const side = k.split(SERIES_DELIM)[0].match(/\.(left|right)_[^.]*$/)?.[1];
    return side && !suffixes[i].startsWith(`${side}_`)
      ? `${side}_${suffixes[i]}`
      : suffixes[i];
  });

  // Build reverse lookup: joint name → column key (for G1 SDK-style columns)
  const g1Reverse = new Map<string, string>();
  for (let i = 0; i < suffixes.length; i++) {
    /// Unitree's whole-body (SMPL) datasets: `robot_q_current | q_7` to `q_35` are the body's joints,
    /// after the root's pose.
    const q = columnKeys[i].includes("robot_q_current")
      ? suffixes[i].match(/^q_(\d+)$/)
      : null;
    const jointName = q
      ? G1_BODY_JOINTS[Number(q[1]) - 7]
      : (G1_SDK_TO_JOINT[suffixes[i]] ?? G1_SDK_TO_JOINT[`${suffixes[i]}.q`]);
    if (jointName) g1Reverse.set(jointName, columnKeys[i]);
  }

  for (const jointName of jointNames) {
    const lower = jointName.toLowerCase();

    // Exact match on column suffix
    const exactIdx = suffixes.findIndex((s) => s === lower);
    if (exactIdx >= 0) {
      mapping[jointName] = columnKeys[exactIdx];
      continue;
    }

    // G1 / Unitree SDK name match
    const g1Col = g1Reverse.get(lower);
    if (g1Col) {
      mapping[jointName] = g1Col;
      continue;
    }

    // Without the `_joint` suffix: left_hip_pitch_joint → `left_hip_pitch`, or `hip_pitch` in left_leg
    const sidedIdx = sided.indexOf(lower.replace(/_joint$/, ""));
    if (sidedIdx >= 0) {
      mapping[jointName] = columnKeys[sidedIdx];
      continue;
    }

    // OpenArm: openarm_(left|right)_joint(\d+) → (left|right)_joint_(\d+) or (left|right)_joint(\d+),
    // whole words so joint1 doesn't take joint10
    const armMatch = lower.match(/^openarm_(left|right)_joint(\d+)$/);
    if (armMatch) {
      const pattern = new RegExp(
        `(^|_)${armMatch[1]}_joint_?${armMatch[2]}(\\D|$)`,
      );
      const idx = suffixes.findIndex((s) => pattern.test(s));
      if (idx >= 0) {
        mapping[jointName] = columnKeys[idx];
        continue;
      }
    }

    // OpenArm: openarm_(left|right)_finger_joint1 → (left|right)_gripper
    const fingerMatch = lower.match(/^openarm_(left|right)_finger_joint1$/);
    if (fingerMatch) {
      const pattern = `${fingerMatch[1]}_gripper`;
      const idx = suffixes.findIndex((s) => s.includes(pattern));
      if (idx >= 0) {
        mapping[jointName] = columnKeys[idx];
        continue;
      }
    }

    // Dex1: both fingers of (left|right)_dex1 → `left_gripper | gripper_pos` or `kLeftGripper`
    const dex1Match = lower.match(/^(left|right)_dex1_finger_joint_[12]$/);
    if (dex1Match) {
      const idx = sided.findIndex((s) =>
        s
          .replace(/^k/, "")
          .replace(/_/g, "")
          .startsWith(`${dex1Match[1]}gripper`),
      );
      if (idx >= 0) {
        mapping[jointName] = columnKeys[idx];
        continue;
      }
    }

    // Inspire: (L|R)_<finger>_proximal_joint and the thumb's yaw and pitch → `left_fig6d | index`,
    // `little`, `thumb_lat` and `thumb_oc`
    const inspireMatch = lower.match(INSPIRE_JOINT);
    if (inspireMatch) {
      const [, side, finger, thumbAxis] = inspireMatch;
      const name =
        finger === "pinky"
          ? "little"
          : thumbAxis === "yaw"
            ? "thumb_lat"
            : thumbAxis === "pitch"
              ? "thumb_oc"
              : finger;
      const idx = sided.indexOf(`${side === "l" ? "left" : "right"}_${name}`);
      const fingerIdx = suffixes.indexOf(
        `finger_${(side === "l" ? 0 : 6) + INSPIRE_FINGERS.indexOf(name)}`,
      );
      if (idx >= 0 || fingerIdx >= 0) {
        mapping[jointName] = columnKeys[idx >= 0 ? idx : fingerIdx];
        continue;
      }
    }

    // BrainCo: <side>_<finger>_proximal_joint and the thumb's metacarpal (sideways) and proximal
    // (bending) joints → `left_fig6d | index`, `little`, `thumb_lat` and `thumb_oc`
    const braincoMatch = lower.match(BRAINCO_JOINT);
    if (braincoMatch) {
      const [, side, finger, thumbJoint] = braincoMatch;
      const name =
        finger === "pinky"
          ? "little"
          : thumbJoint === "metacarpal"
            ? "thumb_lat"
            : thumbJoint === "proximal"
              ? "thumb_oc"
              : finger;
      const idx = sided.indexOf(`${side}_${name}`);
      const fingerIdx = suffixes.indexOf(
        `finger_${(side === "left" ? 0 : 6) + BRAINCO_FINGERS.indexOf(name)}`,
      );
      if (idx >= 0 || fingerIdx >= 0) {
        mapping[jointName] = columnKeys[idx >= 0 ? idx : fingerIdx];
        continue;
      }
    }

    // Generic fuzzy fallback
    const fuzzy = columnKeys.find((k) => k.toLowerCase().includes(lower));
    if (fuzzy) mapping[jointName] = fuzzy;
  }
  return mapping;
}

/** The feature a robot's joints are read from by default: the state, else the action. */
export function defaultColumnGroup(groupNames: string[]): string {
  return (
    groupNames.find((g) => g.toLowerCase().includes("state")) ??
    groupNames.find((g) => g.toLowerCase().includes("action")) ??
    groupNames[0] ??
    ""
  );
}

/**
 * The unit of an episode's joint angles, from the largest value its mapped joints take. Special
 * joints, and those `skip` names (linear joints, in metres), are left out.
 */
export function episodeAngleUnit(
  rows: Record<string, number>[],
  mapping: Record<string, string>,
  jointNames: string[],
  skip: (joint: string) => boolean = () => false,
): AngleUnit {
  let maxAbs = 0;
  for (const jn of jointNames) {
    const col = mapping[jn];
    if (!col || isSpecialJoint(jn) || skip(jn)) continue;
    for (const row of rows) {
      const v = Math.abs(row[col]);
      if (Number.isFinite(v) && v > maxAbs) maxAbs = v;
    }
  }
  return detectAngleUnit(maxAbs);
}
