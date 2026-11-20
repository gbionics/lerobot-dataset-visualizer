/**
 * A custom robot model served from a local directory (ROBOT_MODEL_DIR, `.robot` by default).
 * Nothing about the robot is in the repository: `robot.json` in that directory describes it.
 */
export type RobotManifest = {
  /** URDF path, relative to the model directory. */
  urdf: string;
  /** Datasets whose `robot_type` contains any of these (case-insensitive). Omitted: every dataset. */
  match?: string[];
  /** Uniform scale applied to the model. */
  scale?: number;
  /** Height of the model's root above the floor when the data has no base pose. */
  restHeight?: number;
  /** URDF joint name → dataset column name (the part after the feature prefix). */
  joints?: Record<string, string>;
  /** URDF `package://<name>/` → directory relative to the model directory. Default: `<name>`. */
  packages?: Record<string, string>;
  /** Colour for meshes that carry none of their own. */
  meshColor?: string;
};

const MANIFEST_FILE = "robot.json";

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === "string")
  );
}

/** Returns null when `json` is not a usable manifest. */
export function parseRobotManifest(json: unknown): RobotManifest | null {
  if (typeof json !== "object" || json === null) return null;
  const m = json as Record<string, unknown>;
  if (typeof m.urdf !== "string" || m.urdf === "") return null;
  const manifest: RobotManifest = { urdf: m.urdf };
  if (Array.isArray(m.match) && m.match.every((s) => typeof s === "string"))
    manifest.match = m.match;
  if (typeof m.scale === "number" && m.scale > 0) manifest.scale = m.scale;
  if (typeof m.restHeight === "number") manifest.restHeight = m.restHeight;
  if (isStringRecord(m.joints)) manifest.joints = m.joints;
  if (isStringRecord(m.packages)) manifest.packages = m.packages;
  if (typeof m.meshColor === "string") manifest.meshColor = m.meshColor;
  return manifest;
}

export function robotManifestMatches(
  manifest: RobotManifest,
  robotType: string | null,
): boolean {
  if (!manifest.match || manifest.match.length === 0) return true;
  const lower = (robotType ?? "").toLowerCase();
  return manifest.match.some((s) => lower.includes(s.toLowerCase()));
}

/** Dataset column for each URDF joint named in the manifest, among the given column keys. */
export function manifestJointMapping(
  manifest: RobotManifest,
  columnKeys: string[],
  delimiter: string,
): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const [joint, column] of Object.entries(manifest.joints ?? {})) {
    const wanted = column.toLowerCase();
    const key = columnKeys.find(
      (k) =>
        k.toLowerCase() === wanted ||
        (k.split(delimiter).pop()?.trim() ?? k).toLowerCase() === wanted,
    );
    if (key) mapping[joint] = key;
  }
  return mapping;
}

export const ROBOT_FILES_URL = "/api/local-robot";
export const ROBOT_MANIFEST_URL = `${ROBOT_FILES_URL}/${MANIFEST_FILE}`;
