import type { EpisodeData } from "@/app/[org]/[dataset]/[episode]/fetch-data";
import type { AnomaliesData } from "@/components/urdf-viewer";

interface JointLimit {
  lower: number;
  upper: number;
}

interface JointViolation {
  jointName: string;
  value: number;
  lower: number;
  upper: number;
  columnName: string;
}

interface FrameAnomaly {
  frame: number;
  timestamp: number;
  violations: JointViolation[];
}

/**
 * Detect degrees/radians mix and convert all to radians
 */
function detectAndConvert(values: number[]): number[] {
  if (values.length === 0) return values;
  const absVals = values.map((v) => Math.abs(v));
  const maxAbs = Math.max(...absVals);
  const meanAbs = absVals.reduce((a, b) => a + b, 0) / absVals.length;

  if (maxAbs > 6.5 || meanAbs > 2.0) {
    return values.map((v) => (v * Math.PI) / 180);
  }
  return values;
}

/**
 * Compute anomalies for a given episode based on URDF joint limits
 */
export async function computeEpisodeAnomalies(
  episodeId: number,
  data: EpisodeData,
  robotType: string,
): Promise<AnomaliesData | null> {
  try {
    // Load URDF to extract joint limits
    // Map robot types to URDF paths and files (case-sensitive!)
    let urdfPath: string;
    let urdfFile: string;

    switch (robotType.toLowerCase()) {
      case "so101":
        urdfPath = "/urdf/so101/";
        urdfFile = "so101_new_calib.urdf";
        break;
      case "g1":
        urdfPath = "/urdf/g1/";
        urdfFile = "g1_body29_hand14.urdf";
        break;
      case "ergocub":
        urdfPath = "/urdf/ergoCub/";
        urdfFile = "ergoCubSN002/model.urdf";
        break;
      case "openarm":
        urdfPath = "/urdf/openarm/";
        urdfFile = "openarm_bimanual.urdf";
        break;
      default:
        console.warn(`Unknown robot type: ${robotType}`);
        return null;
    }

    // Fetch URDF
    const response = await fetch(`${urdfPath}${urdfFile}`);
    if (!response.ok) {
      console.error(`Failed to fetch URDF: ${response.statusText}`);
      return null;
    }

    const urdfText = await response.text();
    const parser = new DOMParser();
    const urdfDoc = parser.parseFromString(urdfText, "application/xml");

    // Extract joint limits
    const jointLimits: Record<string, JointLimit> = {};
    const jointElements = urdfDoc.querySelectorAll("joint");
    jointElements.forEach((joint) => {
      const name = joint.getAttribute("name");
      const type = joint.getAttribute("type");
      if (!name || type === "fixed") return;

      const limitEl = joint.querySelector("limit");
      if (limitEl) {
        const lower = parseFloat(limitEl.getAttribute("lower") || "0");
        const upper = parseFloat(limitEl.getAttribute("upper") || "0");
        jointLimits[name] = { lower, upper };
      }
    });

    if (Object.keys(jointLimits).length === 0) {
      console.warn("No joint limits found in URDF");
      return null;
    }

    // Build mapping from URDF joint names to dataset columns
    const mapping = buildJointMapping(robotType, data, jointLimits);
    const urdfJointNames = Object.keys(mapping).filter((k) => mapping[k]);

    if (urdfJointNames.length === 0) {
      console.warn("No joint mappings found");
      return null;
    }

    // Compute gripper ranges for finger joints if needed
    const gripperRanges = computeGripperRanges(
      robotType,
      data,
      mapping,
      urdfJointNames,
    );

    // Scan all frames for violations
    const frameAnomalies: FrameAnomaly[] = [];
    const affectedJoints = new Map<string, number>();
    const tolerance = 0.001;
    const totalFrames = data.flatChartData.length;

    for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
      const row = data.flatChartData[frameIdx];
      const frameViolations: JointViolation[] = [];
      const revoluteValues: number[] = [];
      const revoluteNames: string[] = [];
      const values: Record<string, number> = {};

      // Compute joint values for this frame
      for (const jn of urdfJointNames) {
        if (jn.toLowerCase().includes("finger_joint2")) continue;
        const col = mapping[jn];
        if (!col || typeof row[col] !== "number") continue;
        const raw = row[col];

        if (jn.toLowerCase().includes("finger_joint1")) {
          const range = gripperRanges[jn];
          if (range) {
            const t = (raw - range.min) / (range.max - range.min);
            values[jn] = t * 0.044;
          } else {
            values[jn] = (raw / 100) * 0.044;
          }
        } else {
          revoluteValues.push(raw);
          revoluteNames.push(jn);
        }
      }

      const converted = detectAndConvert(revoluteValues);
      revoluteNames.forEach((n, i) => {
        values[n] = converted[i];
      });

      // Copy finger_joint1 → finger_joint2
      for (const jn of urdfJointNames) {
        if (jn.toLowerCase().includes("finger_joint2")) {
          const j1 = jn.replace(/finger_joint2/, "finger_joint1");
          if (values[j1] !== undefined) values[jn] = values[j1];
        }
      }

      // Check for violations
      for (const [jointName, value] of Object.entries(values)) {
        const limit = jointLimits[jointName];
        if (!limit) continue;

        if (
          value < limit.lower - tolerance ||
          value > limit.upper + tolerance
        ) {
          const columnName = mapping[jointName] ?? jointName;
          frameViolations.push({
            jointName,
            value,
            lower: limit.lower,
            upper: limit.upper,
            columnName,
          });

          affectedJoints.set(
            jointName,
            (affectedJoints.get(jointName) || 0) + 1,
          );
        }
      }

      if (frameViolations.length > 0) {
        const timestamp =
          typeof row.timestamp === "number" ? row.timestamp : frameIdx / 30;
        frameAnomalies.push({
          frame: frameIdx,
          timestamp,
          violations: frameViolations,
        });
      }
    }

    return {
      episodeId,
      totalFrames,
      frameAnomalies,
      affectedJoints,
    };
  } catch (error) {
    console.error(`Error computing anomalies for episode ${episodeId}:`, error);
    return null;
  }
}

function buildJointMapping(
  robotType: string,
  data: EpisodeData,
  jointLimits: Record<string, JointLimit>,
): Record<string, string> {
  const mapping: Record<string, string> = {};
  const columns = Object.keys(data.flatChartData[0] || {});

  switch (robotType.toLowerCase()) {
    case "so101": {
      // SO-101 mapping
      for (const jn of Object.keys(jointLimits)) {
        const suffix = jn.replace(/_joint$/, "");
        const candidates = columns.filter((c) => c.endsWith(suffix));
        if (candidates.length > 0) mapping[jn] = candidates[0];
      }
      break;
    }

    case "g1": {
      // Unitree G1 SDK → URDF mapping
      const G1_SDK_TO_URDF: Record<string, string> = {
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
      };

      for (const [sdkKey, urdfJoint] of Object.entries(G1_SDK_TO_URDF)) {
        if (jointLimits[urdfJoint]) {
          const col = columns.find((c) => c.endsWith(sdkKey));
          if (col) mapping[urdfJoint] = col;
        }
      }
      break;
    }

    case "ergocub": {
      // ergoCub mapping
      const ERGOCUB_URDF_TO_SUFFIX: Record<string, string> = {
        l_thumb_prox: "l_thumb_oc",
        l_thumb_dist: "l_thumb_oc",
        l_index_add: "l_index_oc",
        l_index_prox: "l_index_oc",
        l_index_dist: "l_index_oc",
        l_middle_prox: "l_middle_oc",
        l_middle_dist: "l_middle_oc",
        l_ring_prox: "l_ring_pinky_oc",
        l_ring_dist: "l_ring_pinky_oc",
        l_pinkie_prox: "l_ring_pinky_oc",
        l_pinkie_dist: "l_ring_pinky_oc",
        r_thumb_prox: "r_thumb_oc",
        r_thumb_dist: "r_thumb_oc",
        r_index_add: "r_index_oc",
        r_index_prox: "r_index_oc",
        r_index_dist: "r_index_oc",
        r_middle_prox: "r_middle_oc",
        r_middle_dist: "r_middle_oc",
        r_ring_prox: "r_ring_pinky_oc",
        r_ring_dist: "r_ring_pinky_oc",
        r_pinkie_prox: "r_ring_pinky_oc",
        r_pinkie_dist: "r_ring_pinky_oc",
      };

      for (const jn of Object.keys(jointLimits)) {
        const suffix = ERGOCUB_URDF_TO_SUFFIX[jn] || jn;
        const col = columns.find((c) => c.endsWith(suffix));
        if (col) mapping[jn] = col;
      }
      break;
    }

    default: {
      // Generic fallback
      for (const jn of Object.keys(jointLimits)) {
        const col = columns.find((c) => c.endsWith(jn));
        if (col) mapping[jn] = col;
      }
    }
  }

  return mapping;
}

function computeGripperRanges(
  robotType: string,
  data: EpisodeData,
  mapping: Record<string, string>,
  urdfJointNames: string[],
): Record<string, { min: number; max: number }> {
  const ranges: Record<string, { min: number; max: number }> = {};

  if (robotType.toLowerCase() !== "so101") {
    return ranges;
  }

  // Compute ranges for SO-101 gripper joints
  for (const jn of urdfJointNames) {
    if (!jn.toLowerCase().includes("finger_joint1")) continue;
    const col = mapping[jn];
    if (!col) continue;

    let min = Infinity;
    let max = -Infinity;

    for (const row of data.flatChartData) {
      const val = row[col];
      if (typeof val === "number" && !isNaN(val)) {
        if (val < min) min = val;
        if (val > max) max = val;
      }
    }

    if (isFinite(min) && isFinite(max)) {
      ranges[jn] = { min, max };
    }
  }

  return ranges;
}
