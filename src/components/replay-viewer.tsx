"use client";

import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import {
  OrbitControls,
  Grid,
  Html,
  Environment,
  Lightformer,
} from "@react-three/drei";
import * as THREE from "three";
import { loadUsd, type LoadResult } from "@huggingface/usd-web-viewer";
import type { EpisodeData } from "@/app/[org]/[dataset]/[episode]/fetch-data";
import { loadEpisodeFlatChartData } from "@/app/[org]/[dataset]/[episode]/fetch-data";
import ReplayPlaybackBar from "@/components/replay-playback-bar";
import {
  TipTrail,
  trailStyle,
  type TrailMode,
} from "@/components/replay-trail";
import { tipSide } from "@/lib/trail";
import RobotLoader, { type LoaderRobot } from "@/components/robot-loader";
import CustomRobotScene from "@/components/custom-robot-scene";
import { isLocalMode } from "@/utils/localDatasetShared";
import {
  manifestJointMapping,
  robotManifestMatches,
} from "@/utils/robotManifest";
import { useRobotManifest } from "@/utils/useRobotManifest";
import { CHART_CONFIG } from "@/utils/constants";
import { getDatasetVersionAndInfo } from "@/utils/versionUtils";
import type { DatasetMetadata } from "@/utils/parquetUtils";
import { useTheme } from "@/utils/theme";
import {
  BRAINCO_JOINT,
  INSPIRE_JOINT,
  autoMatchJoints,
  defaultColumnGroup,
  episodeAngleUnit,
  groupColumnsByPrefix,
  type AngleUnit,
} from "@/utils/jointMapping";
import {
  findLimitViolations,
  formatOvershoot,
  framesOverRanges,
  jointLimitsOf,
  jointsOverAt,
  jointValue,
  type JointLimit,
} from "@/utils/jointLimits";
import { useUrdfJoints } from "@/utils/useUrdfJoints";
import { Switch } from "@/components/ui";

const SERIES_DELIM = CHART_CONFIG.SERIES_NAME_DELIMITER;
const DEG2RAD = Math.PI / 180;

/// USD models of the robots: each draws its robot and, through its joints, moves it.
const USD_BASE_URL =
  "https://huggingface.co/datasets/lerobot/robot-usds/resolve/main";

/// Kept for the session: the viewer remounts on every visit to the 3D Replay tab.
const usdBlobCache = new Map<string, Promise<Blob>>();

function loadUsdBlob(url: string): Promise<Blob> {
  let loading = usdBlobCache.get(url);
  if (!loading) {
    loading = fetch(url)
      .then((res) => {
        if (!res.ok)
          throw new Error(`Failed to load USD ${url} (HTTP ${res.status})`);
        return res.blob();
      })
      .catch((err) => {
        usdBlobCache.delete(url);
        throw err;
      });
    usdBlobCache.set(url, loading);
  }
  return loading;
}

/**
 * Starts downloading a robot's model into the cache. The viewer only mounts once the episode data has
 * loaded, and the model used to start downloading only then; calling this earlier overlaps the two.
 */
export function prefetchRobotModel(
  robotType: string | null,
  columns: string[],
) {
  /// In local mode nothing is fetched until the model to show is known.
  if (isLocalMode()) return;
  /// A failed download leaves the cache, so the viewer tries again and reports it.
  loadUsdBlob(getRobotConfig(robotType, columns).usdUrl).catch(() => {});
}

/// Unitree's Dex1-1 grippers record `left_gripper | gripper_pos`, or `kLeftGripper`.
function hasDex1Grippers(columns: string[]): boolean {
  return columns.some((c) =>
    /\.(left|right)_gripper \||\| k(left|right)gripper$/i.test(c),
  );
}

/// `columns` as in the episode's chart data (`feature | name`), to tell the G1's hands apart.
function getRobotConfig(
  robotType: string | null,
  columns: string[],
): {
  robot: LoaderRobot;
  usdUrl: string;
  scale: number;
  /** Height of the model's root above the floor when the data has no base pose. */
  restHeight: number;
} {
  const lower = (robotType ?? "").toLowerCase();
  if (lower.includes("g1") || lower.includes("unitree")) {
    if (lower.includes("inspire")) {
      return {
        robot: "g1",
        usdUrl: `${USD_BASE_URL}/g1_body29_inspire/simready_usd/g1_body29_inspire.usd`,
        scale: 1,
        restHeight: 0.793,
      };
    }
    if (lower.includes("brainco")) {
      return {
        robot: "g1",
        usdUrl: `${USD_BASE_URL}/g1_body29_brainco/simready_usd/g1_body29_brainco.usd`,
        scale: 1,
        restHeight: 0.793,
      };
    }
    if (hasDex1Grippers(columns)) {
      return {
        robot: "g1",
        usdUrl: `${USD_BASE_URL}/g1_body29_dex1/simready_usd/g1_body29_dex1.usd`,
        scale: 1,
        restHeight: 0.793,
      };
    }
    return {
      robot: "g1",
      usdUrl: `${USD_BASE_URL}/g1_body29_hand14/simready_usd/g1_body29_hand14.usd`,
      scale: 1,
      /// The pelvis, standing on straight legs.
      restHeight: 0.793,
    };
  }
  if (lower.includes("openarm")) {
    return {
      robot: "openarm",
      usdUrl: `${USD_BASE_URL}/openarm_bimanual/simready_usd/openarm_bimanual.usd`,
      scale: 3,
      restHeight: 0,
    };
  }
  return {
    robot: "so101",
    usdUrl: `${USD_BASE_URL}/so101_new_calib/simready_usd/so101_new_calib.usd`,
    scale: 10,
    restHeight: 0,
  };
}

/** Where the robot is at one frame: joint values by joint name, and the base pose (x y z qx qy qz qw). */
type FramePose = { joints: Record<string, number>; base: number[] };

const BASE_POSE_NAMES = ["x", "y", "z", "qx", "qy", "qz", "qw"];
const Z_UP_TO_Y_UP = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0),
  -Math.PI / 2,
);

/// The columns of a floating base's pose in the world (x, y, z, qx, qy, qz, qw), such as Unitree's
/// `state_base_pose`.
function findBasePoseColumns(columnKeys: string[]): string[] | null {
  const features = columnKeys.map((k) => k.split(SERIES_DELIM)[0]);
  const feature = features.find((f) => f.endsWith("base_pose"));
  /// Unitree's whole-body (SMPL) datasets start `robot_q_current` with the root's x, y, z, qw, qx,
  /// qy, qz.
  const qFeature = features.find((f) => f.endsWith("robot_q_current"));
  const columns = feature
    ? BASE_POSE_NAMES.map((n) => `${feature}${SERIES_DELIM}${n}`)
    : qFeature
      ? [0, 1, 2, 4, 5, 6, 3].map((i) => `${qFeature}${SERIES_DELIM}q_${i}`)
      : null;
  return columns?.every((c) => columnKeys.includes(c)) ? columns : null;
}

const SINGLE_ARM_TIP_NAMES = [
  "gripper_frame_link",
  "gripperframe",
  "gripper_link",
  "gripper",
];
const DUAL_ARM_TIP_NAMES = ["openarm_left_hand_tcp", "openarm_right_hand_tcp"];
/// The hands' palms (Dex3) or bases (Inspire, BrainCo), or the Dex1 grippers' bases: all on the
/// wrist's flange.
const G1_TIP_NAMES = [
  "left_hand_palm_link",
  "right_hand_palm_link",
  "left_dex1_base_link",
  "right_dex1_base_link",
  "L_hand_base_link",
  "R_hand_base_link",
  "left_base_link",
  "right_base_link",
];
/// Unitree's Dex1-1 gripper motor turns 5.4 rad from closed to open, each finger sliding from
/// -0.02 m to 0.0245 m.
const DEX1_MOTOR_TRAVEL = 5.4;
const DEX1_FINGER_CLOSED = -0.02;
const DEX1_FINGER_OPEN = 0.0245;

/**
 * An Inspire motor's joint angle from its recorded value, 1 open to 0 closed (Unitree's
 * xr_teleoperate): fingers curl to 1.7 rad, the thumb bends to 0.5 rad and turns from 1.3 to -0.1 rad.
 */
function inspireJointValue(joint: string, open: number): number {
  if (joint.endsWith("_yaw_joint")) return 1.3 - 1.4 * open;
  if (joint.endsWith("_pitch_joint")) return 0.5 * (1 - open);
  return 1.7 * (1 - open);
}

/**
 * A BrainCo motor's joint angle from its recorded value, 1 open to 0 closed: Unitree records one
 * minus the hand's closure, which spans each joint's range (1.52 rad for the thumb's metacarpal
 * joint, 1.05 for its proximal joint, 1.47 for the fingers).
 */
function braincoJointValue(joint: string, open: number): number {
  if (joint.endsWith("_thumb_metacarpal_joint")) return 1.5184 * (1 - open);
  if (joint.endsWith("_thumb_proximal_joint")) return 1.0472 * (1 - open);
  return 1.4661 * (1 - open);
}

/// A joint whose limits are equal, like the BrainCo fingertips', stays where they put it.
function isLocked(joint: LoadResult["joints"][number]): boolean {
  return (
    (joint.kind === "revolute" || joint.kind === "prismatic") &&
    joint.lower !== null &&
    joint.lower === joint.upper
  );
}
/** How much of the past the trail's bright tail covers, in seconds of the episode. */
const TRAIL_SECONDS = 2;
/** How far either side of now the whole episode's path shows in full, in seconds. */
const TRAIL_CONTEXT_SECONDS = 12;
/** Above this height, in meters, the trail casts no shadow on the floor. */
const TRAIL_SHADOW_HEIGHT = 0.35;
/** Time the episode's path may take from the page per slice of work, in milliseconds. */
const PATH_SLICE_MS = 10;

/** Drivable joints by name, as `RobotScene` keeps them. */
type JointMap = Map<string, { path: string; revolute: boolean }>;

const poseQuaternion = new THREE.Quaternion();

/**
 * Puts the model where a frame has it. The robot stays above the origin, where the camera looks,
 * and the floor moves under it; the robots' USDs are Z-up, like the base pose.
 */
function applyPose(
  model: LoadResult,
  joints: JointMap,
  pose: FramePose,
  scale: number,
): void {
  const [, , z, qx, qy, qz, qw] = pose.base;
  model.root.position.set(0, z * scale, 0);
  model.root.quaternion
    .copy(Z_UP_TO_Y_UP)
    .multiply(poseQuaternion.set(qx, qy, qz, qw));
  const positions: Record<string, number> = {};
  for (const [name, value] of Object.entries(pose.joints)) {
    const joint = joints.get(name);
    if (joint) positions[joint.path] = joint.revolute ? value / DEG2RAD : value;
  }
  model.setJointPositions(positions);
}

/**
 * Frames the robot's world-space bounding box. Models can have a world→base offset (SO-arm does) that
 * puts the robot far from origin, so a fixed camera pose crops the arm.
 */
function fitCameraToRobot(
  robot: THREE.Object3D,
  camera: THREE.Camera,
  controls: unknown,
  /** The trails' paths: framed with the robot, so the workspace it moves through is in view. */
  paths?: THREE.Box3,
) {
  const bbox = new THREE.Box3().setFromObject(robot);
  if (bbox.isEmpty()) return;
  if (paths && !paths.isEmpty()) {
    const both = bbox.clone().union(paths);
    // A route walked across the room would shrink the robot to a speck: frame the robot alone.
    const robotSize = bbox.getSize(new THREE.Vector3()).length();
    if (both.getSize(new THREE.Vector3()).length() <= robotSize * 2.5)
      bbox.copy(both);
  }
  const center = bbox.getCenter(new THREE.Vector3());
  const sizeVec = bbox.getSize(new THREE.Vector3());
  const maxDim = Math.max(sizeVec.x, sizeVec.y, sizeVec.z);
  const fov = ((camera as THREE.PerspectiveCamera).fov ?? 45) * (Math.PI / 180);
  const distance = (maxDim / 2 / Math.tan(fov / 2)) * 1.6;
  const dir = new THREE.Vector3(1, 0.85, 1).normalize();
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.lookAt(center);
  (camera as THREE.PerspectiveCamera).updateProjectionMatrix?.();
  const orbit = controls as { target?: THREE.Vector3; update?: () => void };
  if (orbit?.target) {
    orbit.target.copy(center);
    orbit.update?.();
  }
}

const TRAIL_MODE_KEY = "lerobot-viz-replay-trail";

/** The trail chosen on an earlier visit; the whole episode's path by default. */
function readTrailMode(): TrailMode {
  try {
    const stored = localStorage.getItem(TRAIL_MODE_KEY);
    if (stored === "off" || stored === "recent" || stored === "episode")
      return stored;
  } catch {
    // Storage blocked: the default.
  }
  return "episode";
}

/** Frames to wait for joint values before fitting anyway (a robot with no mapped joints). */
const MAX_FIT_WAIT_FRAMES = 30;
/** How long the first fit waits for the trails' paths, to frame them too, in milliseconds. */
const MAX_PATH_WAIT_MS = 2500;

// ─── Robot scene (imperative, inside Canvas) ───
function RobotScene({
  robot,
  usdUrl,
  jointValues,
  basePose,
  onJointsLoaded,
  onTrailSides,
  poseAt,
  totalFrames,
  frame,
  fps,
  trailMode,
  dark,
  scale,
}: {
  robot: LoaderRobot;
  usdUrl: string;
  jointValues: Record<string, number>;
  basePose: number[];
  onJointsLoaded: (names: string[]) => void;
  /** Which side each trail is on, once the model's tool points are known. */
  onTrailSides: (sides: ("left" | "right" | null)[]) => void;
  /** The pose at any frame of the episode, for its path. */
  poseAt: (frame: number) => FramePose;
  totalFrames: number;
  frame: number;
  fps: number;
  trailMode: TrailMode;
  dark: boolean;
  scale: number;
}) {
  const { scene, size, viewport, invalidate } = useThree();
  const modelRef = useRef<LoadResult | null>(null);
  /// Bumped when a model loads, so the path is worked out for it.
  const [modelVersion, setModelVersion] = useState(0);
  /// The joints the data drives, by name: a mimic joint follows its joint and a locked one doesn't
  /// move, so neither is one.
  const jointsRef = useRef<JointMap>(new Map());
  /// Prim paths whose positions the trails follow.
  const tipPathsRef = useRef<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  /// Fixed to the floor, which moves under the robot when the data has a base pose: the trails
  /// live in it, so a path walked across the room stays where it was walked.
  const floor = useMemo(() => new THREE.Group(), []);
  const trailsRef = useRef<TipTrail[]>([]);
  const darkRef = useRef(dark);
  darkRef.current = dark;
  /// Set once the model loads; the frame loop fits the camera on the first frame that has the
  /// episode's pose applied, since the joint values arrive a render later.
  const pendingFitRef = useRef(false);
  const pendingFitFramesRef = useRef(0);
  const pendingFitSinceRef = useRef(0);
  /// Whether the trails have the current episode's path.
  const pathReadyRef = useRef(false);

  useEffect(() => {
    scene.add(floor);
    return () => {
      scene.remove(floor);
    };
  }, [scene, floor]);

  /// useFrame applies these, so R3F can't tell they changed: request a frame.
  useEffect(() => {
    invalidate();
  }, [jointValues, basePose, frame, trailMode, dark, invalidate]);

  useEffect(() => {
    trailsRef.current.forEach((trail, t) =>
      trail.setStyle(trailStyle(tipSide(tipPathsRef.current[t] ?? ""), dark)),
    );
  }, [dark]);

  useEffect(() => {
    setError(null);
    let cancelled = false;
    let model: LoadResult | undefined;
    let trails: TipTrail[] = [];
    /// Loaded from memory, so the session cache spares a download on every visit to the tab.
    const name = usdUrl.slice(usdUrl.lastIndexOf("/") + 1);
    loadUsdBlob(usdUrl)
      .then((blob) => loadUsd(name, { files: new Map([[name, blob]]) }))
      .then((loaded) => {
        if (cancelled) return loaded.dispose();
        model = loaded;
        modelRef.current = loaded;
        const { root, info, joints } = loaded;
        /// On top of meters per unit, which the loader sets.
        root.scale.multiplyScalar(scale);
        root.traverse((c) => {
          c.castShadow = true;
          if (robot !== "openarm") c.receiveShadow = true;
        });
        scene.add(root);

        /// Frames are often meshless points, like a gripper's tip; the G1's palms are meshes.
        const prims = [
          ...info.physics.bodies.map((b) => b.path),
          ...info.physics.frames.map((f) => f.path),
          ...root.children.map((c) => c.name),
        ];
        const tips: string[] = [];
        for (const tipName of robot === "g1"
          ? G1_TIP_NAMES
          : robot === "openarm"
            ? DUAL_ARM_TIP_NAMES
            : SINGLE_ARM_TIP_NAMES) {
          const path = prims.find((p) => p.endsWith(`/${tipName}`));
          if (path) tips.push(path);
          if (robot === "so101" && tips.length === 1) break;
        }
        tipPathsRef.current = tips;
        const sides = tips.map(tipSide);
        trails = sides.map((side) => {
          const trail = new TipTrail(trailStyle(side, darkRef.current));
          floor.add(trail.group);
          return trail;
        });
        trailsRef.current = trails;
        onTrailSides(sides);

        jointsRef.current = new Map(
          joints
            .filter((j) => !j.mimic && !isLocked(j))
            .map((j) => [
              j.path.slice(j.path.lastIndexOf("/") + 1),
              { path: j.path, revolute: j.kind === "revolute" },
            ]),
        );
        onJointsLoaded([...jointsRef.current.keys()]);
        pendingFitRef.current = true;
        pendingFitFramesRef.current = 0;
        pendingFitSinceRef.current = performance.now();
        setModelVersion((v) => v + 1);
        invalidate();
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Error loading the robot model:", err);
        setError(String(err));
      });
    return () => {
      cancelled = true;
      for (const trail of trails) trail.dispose();
      trailsRef.current = [];
      if (model) {
        scene.remove(model.root);
        model.dispose();
      }
      modelRef.current = null;
      tipPathsRef.current = [];
    };
  }, [
    robot,
    usdUrl,
    scale,
    scene,
    floor,
    onJointsLoaded,
    onTrailSides,
    invalidate,
  ]);

  /// The tool points' path through the whole episode: the model posed at every frame, in slices so
  /// the page stays responsive. The frame loop puts the current pose back before every render.
  useEffect(() => {
    const model = modelRef.current;
    const tips = tipPathsRef.current;
    const trails = trailsRef.current;
    const joints = jointsRef.current;
    if (!model || tips.length === 0 || totalFrames === 0 || joints.size === 0)
      return;
    for (const trail of trails) trail.setSamples(null);
    pathReadyRef.current = false;
    const samples = tips.map(() =>
      new Float32Array(totalFrames * 3).fill(Number.NaN),
    );
    const at = new THREE.Vector3();
    let next = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = () => {
      const started = performance.now();
      for (; next < totalFrames; next++) {
        if (performance.now() - started > PATH_SLICE_MS) {
          timer = setTimeout(work, 0);
          return;
        }
        const pose = poseAt(next);
        try {
          applyPose(model, joints, pose, scale);
        } catch {
          continue;
        }
        /// Into the floor's frame, which the frame loop moves to where the floor is now.
        const [bx, by] = pose.base;
        tips.forEach((tip, t) => {
          const matrix = model.getWorldMatrix(tip);
          if (!matrix) return;
          at.setFromMatrixPosition(matrix);
          samples[t].set(
            [at.x + bx * scale, at.y, at.z - by * scale],
            next * 3,
          );
        });
      }
      trails.forEach((trail, t) => trail.setSamples(samples[t]));
      pathReadyRef.current = true;
      invalidate();
    };
    timer = setTimeout(work, 0);
    return () => clearTimeout(timer);
  }, [modelVersion, poseAt, totalFrames, scale, invalidate]);

  useFrame((state) => {
    const model = modelRef.current;
    if (!model) return;

    applyPose(
      model,
      jointsRef.current,
      { joints: jointValues, base: basePose },
      scale,
    );

    /// Where the grid is: the floor, seen from the robot.
    floor.position.set(-basePose[0] * scale, 0, basePose[1] * scale);

    if (pendingFitRef.current) {
      pendingFitFramesRef.current++;
      const posed =
        Object.keys(jointValues).length > 0 ||
        pendingFitFramesRef.current > MAX_FIT_WAIT_FRAMES;
      const pathsSettled =
        pathReadyRef.current ||
        trailsRef.current.length === 0 ||
        performance.now() - pendingFitSinceRef.current > MAX_PATH_WAIT_MS;
      if (posed && pathsSettled) {
        pendingFitRef.current = false;
        const paths = new THREE.Box3();
        const box = new THREE.Box3();
        for (const trail of trailsRef.current) paths.union(trail.bounds(box));
        // Where the paths are now: the floor's frame, moved to where the floor is.
        if (!paths.isEmpty()) paths.translate(floor.position);
        fitCameraToRobot(model.root, state.camera, state.controls, paths);
      }
    }
    /// The fit wait counts rendered frames and time: keep rendering until it is done.
    if (pendingFitRef.current) state.invalidate();

    for (const trail of trailsRef.current) {
      trail.update({
        frame,
        tailFrames: TRAIL_SECONDS * fps,
        contextFrames: TRAIL_CONTEXT_SECONDS * fps,
        shadowHeight: TRAIL_SHADOW_HEIGHT * scale,
        mode: trailMode,
        width: size.width,
        height: size.height,
        pixelRatio: viewport.dpr,
      });
    }
  });

  // Loading state is rendered by the outer overlay (via modelLoading) so we
  // don't show two stacked spinners. The error state still surfaces inline
  // since the overlay doesn't have an error path.
  if (error)
    return (
      <Html center>
        <span className="text-red-400">Failed to load the 3D model</span>
      </Html>
    );
  return null;
}

// ─── Playback ticker ───
function PlaybackDriver({
  playing,
  fps,
  totalFrames,
  frameRef,
  setFrame,
}: {
  playing: boolean;
  fps: number;
  totalFrames: number;
  frameRef: React.MutableRefObject<number>;
  setFrame: React.Dispatch<React.SetStateAction<number>>;
}) {
  const elapsed = useRef(0);
  const last = useRef(0);
  useEffect(() => {
    if (!playing) return;
    let raf: number;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = (now - last.current) / 1000;
      last.current = now;
      if (dt > 0 && dt < 0.5) {
        elapsed.current += dt;
        const fd = Math.floor(elapsed.current * fps);
        if (fd > 0) {
          elapsed.current -= fd / fps;
          frameRef.current = (frameRef.current + fd) % totalFrames;
          setFrame(frameRef.current);
        }
      }
    };
    last.current = performance.now();
    elapsed.current = 0;
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, fps, totalFrames, frameRef, setFrame]);
  return null;
}

// IBL: procedural studio softboxes give mesh highlights somewhere to bounce.
// Not preset="studio": drei downloads that 1.6 MB HDR from raw.githack.com and
// suspends the canvas until it arrives. Module scope keeps the element's
// identity across ReplayViewer renders (one per playback frame): drei re-captures
// the cube map and three re-runs PMREM whenever Environment's children change.
const STUDIO_ENVIRONMENT = (
  <Environment resolution={256} background={false}>
    <Lightformer
      form="rect"
      intensity={5}
      position={[0, 5, 0]}
      rotation-x={Math.PI / 2}
      scale={[10, 10, 1]}
    />
    <Lightformer
      form="rect"
      intensity={3}
      position={[-5, 1.5, -1]}
      rotation-y={Math.PI / 2}
      scale={[10, 2, 1]}
    />
    <Lightformer
      form="rect"
      intensity={3}
      position={[5, 1.5, -1]}
      rotation-y={-Math.PI / 2}
      scale={[10, 2, 1]}
    />
    <Lightformer
      form="rect"
      intensity={2.5}
      position={[0, 1.5, 5]}
      rotation-y={Math.PI}
      scale={[10, 3, 1]}
    />
  </Environment>
);

// ═══════════════════════════════════════
// ─── Main 3D Replay viewer ───
// ═══════════════════════════════════════
export default function ReplayViewer({
  data,
  org,
  dataset,
  episodeChangerRef,
  playToggleRef,
}: {
  data: EpisodeData;
  org?: string;
  dataset?: string;
  episodeChangerRef?: React.RefObject<((ep: number) => void) | undefined>;
  playToggleRef?: React.RefObject<(() => void) | undefined>;
}) {
  const { datasetInfo } = data;
  const fps = datasetInfo.fps || 30;
  /// Three.js needs real colours, so the scene reads the theme instead of CSS variables.
  const dark = useTheme() === "dark";
  const robotConfig = useMemo(
    () =>
      getRobotConfig(
        datasetInfo.robot_type,
        Object.keys(data.flatChartData[0] ?? {}),
      ),
    [datasetInfo.robot_type, data.flatChartData],
  );
  const manifest = useRobotManifest();
  const customRobot =
    manifest && robotManifestMatches(manifest, datasetInfo.robot_type)
      ? manifest
      : null;
  const { robot, usdUrl } = robotConfig;
  const scale = customRobot ? (customRobot.scale ?? 1) : robotConfig.scale;
  const restHeight = customRobot
    ? (customRobot.restHeight ?? 0)
    : robotConfig.restHeight;
  const isG1 = robot === "g1";
  const isOpenArm = robot === "openarm";
  const repoId = org && dataset ? `${org}/${dataset}` : null;
  const datasetInfoRef = useRef<{
    version: string;
    info: DatasetMetadata;
  } | null>(null);

  const ensureDatasetInfo = useCallback(async () => {
    if (!repoId) return null;
    if (datasetInfoRef.current) return datasetInfoRef.current;
    const { version, info } = await getDatasetVersionAndInfo(repoId);
    const payload = { version, info: info as unknown as DatasetMetadata };
    datasetInfoRef.current = payload;
    return payload;
  }, [repoId]);

  // Episode selection & chart data
  const [selectedEpisode, setSelectedEpisode] = useState(data.episodeId);
  const [chartData, setChartData] = useState(data.flatChartData);
  const [episodeLoading, setEpisodeLoading] = useState(false);
  const chartDataCache = useRef<Record<number, Record<string, number>[]>>({
    [data.episodeId]: data.flatChartData,
  });
  /// A slower load for an earlier pick must not overwrite the episode picked since.
  const latestEpisodeRef = useRef(data.episodeId);

  const handleEpisodeChange = useCallback(
    (epId: number) => {
      latestEpisodeRef.current = epId;
      setSelectedEpisode(epId);
      setFrame(0);
      frameRef.current = 0;
      setPlaying(false);

      if (chartDataCache.current[epId]) {
        setChartData(chartDataCache.current[epId]);
        setEpisodeLoading(false);
        return;
      }

      if (!repoId) return;
      setEpisodeLoading(true);
      ensureDatasetInfo()
        .then((payload) => {
          if (!payload) return null;
          return loadEpisodeFlatChartData(
            repoId,
            payload.version,
            payload.info,
            epId,
          );
        })
        .then((result) => {
          if (!result) return;
          chartDataCache.current[epId] = result;
          if (latestEpisodeRef.current === epId) setChartData(result);
        })
        .catch((err) => console.error("Failed to load episode:", err))
        .finally(() => {
          if (latestEpisodeRef.current === epId) setEpisodeLoading(false);
        });
    },
    [ensureDatasetInfo, repoId],
  );

  useEffect(() => {
    if (episodeChangerRef) episodeChangerRef.current = handleEpisodeChange;
  }, [episodeChangerRef, handleEpisodeChange]);

  const totalFrames = chartData.length;

  // The model's joint names
  const [jointNames, setJointNames] = useState<string[]>([]);
  const onJointsLoaded = useCallback(
    (names: string[]) => setJointNames(names),
    [],
  );

  // Feature groups
  const columnGroups = useMemo(() => {
    if (totalFrames === 0) return {};
    return groupColumnsByPrefix(Object.keys(chartData[0]));
  }, [chartData, totalFrames]);

  const groupNames = useMemo(() => Object.keys(columnGroups), [columnGroups]);
  const defaultGroup = useMemo(
    () => defaultColumnGroup(groupNames),
    [groupNames],
  );

  const [selectedGroup, setSelectedGroup] = useState(defaultGroup);
  useEffect(() => setSelectedGroup(defaultGroup), [defaultGroup]);
  const selectedColumns = useMemo(
    () => columnGroups[selectedGroup] ?? [],
    [columnGroups, selectedGroup],
  );

  // Joint mapping
  const autoMapping = useMemo(
    () => ({
      ...autoMatchJoints(jointNames, selectedColumns),
      ...(customRobot
        ? manifestJointMapping(customRobot, selectedColumns, SERIES_DELIM)
        : {}),
    }),
    [jointNames, selectedColumns, customRobot],
  );
  const [mapping, setMapping] = useState<Record<string, string>>(autoMapping);
  useEffect(() => setMapping(autoMapping), [autoMapping]);
  const basePoseColumns = useMemo(
    () => findBasePoseColumns(selectedColumns),
    [selectedColumns],
  );

  // Trail
  const [trailMode, setTrailModeState] = useState<TrailMode>(readTrailMode);
  const setTrailMode = useCallback((mode: TrailMode) => {
    setTrailModeState(mode);
    try {
      localStorage.setItem(TRAIL_MODE_KEY, mode);
    } catch {
      // Storage blocked: the choice lasts for this visit.
    }
  }, []);
  const [trailSides, setTrailSides] = useState<("left" | "right" | null)[]>([]);
  const [showMapping, setShowMapping] = useState(false);

  // Playback
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const frameRef = useRef(0);

  const handleFrameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = parseInt(e.target.value);
      setFrame(f);
      frameRef.current = f;
    },
    [],
  );

  // The model downloads async from the Hub. Until its joints are reported
  // back, playback/scrub inputs would drive an empty scene, so we gate
  // interactions (and pause if already playing).
  const modelLoading = jointNames.length === 0;

  useEffect(() => {
    if (modelLoading) setPlaying(false);
  }, [modelLoading]);

  const handlePlayPause = useCallback(() => {
    if (modelLoading) return;
    setPlaying((prev) => {
      if (!prev) frameRef.current = frame;
      return !prev;
    });
  }, [frame, modelLoading]);

  useEffect(() => {
    if (playToggleRef) playToggleRef.current = handlePlayPause;
  }, [playToggleRef, handlePlayPause]);

  // Auto-detect gripper column range for linear mapping to 0-0.044m
  const gripperRanges = useMemo(() => {
    const ranges: Record<string, { min: number; max: number }> = {};
    for (const jn of jointNames) {
      if (!jn.toLowerCase().includes("finger_joint1")) continue;
      const col = mapping[jn];
      if (!col) continue;
      let min = Infinity,
        max = -Infinity;
      for (const row of chartData) {
        const v = row[col];
        if (typeof v === "number") {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      if (min < max) ranges[jn] = { min, max };
    }
    return ranges;
  }, [chartData, mapping, jointNames]);

  // The custom robot's URDF: its joint types (a prismatic joint is in metres) and limits.
  const urdfJoints = useUrdfJoints(customRobot);
  const jointTypes = useMemo(
    () =>
      new Map(
        (customRobot && urdfJoints ? urdfJoints : []).map((j) => [
          j.name,
          j.type,
        ]),
      ),
    [customRobot, urdfJoints],
  );
  const limits = useMemo<Record<string, JointLimit>>(
    () => (customRobot && urdfJoints ? jointLimitsOf(urdfJoints) : {}),
    [customRobot, urdfJoints],
  );

  /// The unit the episode's joint angles are in, from the largest value they take anywhere in it.
  const angleUnit = useMemo<AngleUnit>(
    () =>
      episodeAngleUnit(
        chartData,
        mapping,
        jointNames,
        (jn) => jointTypes.get(jn) === "prismatic",
      ),
    [chartData, jointNames, mapping, jointTypes],
  );

  const limitReport = useMemo(
    () => findLimitViolations(chartData, mapping, limits, angleUnit),
    [chartData, mapping, limits, angleUnit],
  );
  const limitMarks = useMemo(
    () => framesOverRanges(limitReport),
    [limitReport],
  );
  const hasLimits = Object.keys(limits).length > 0;
  const [showLimits, setShowLimits] = useState(true);
  const [showLimitReport, setShowLimitReport] = useState(false);
  /// Joints past a limit on this frame; a new Set only when they change, so the scene isn't redone.
  const overKey = useMemo(
    () => [...jointsOverAt(limitReport, frame)].sort().join("\n"),
    [limitReport, frame],
  );
  const overNow = useMemo(
    () => new Set(overKey ? overKey.split("\n") : []),
    [overKey],
  );
  /// Three.js needs a real colour: the token's value, read again when the theme changes.
  const criticalColor = useMemo(() => {
    void dark;
    if (typeof window === "undefined") return undefined;
    return (
      getComputedStyle(document.documentElement)
        .getPropertyValue("--status-critical")
        .trim() || undefined
    );
  }, [dark]);
  const seekFrame = useCallback((f: number) => {
    setPlaying(false);
    setFrame(f);
    frameRef.current = f;
  }, []);

  /// The pose at any frame: the scene shows the current one, and works out the trail's path
  /// from all of them.
  const poseAt = useCallback(
    (index: number): FramePose => {
      const joints: Record<string, number> = {};
      if (totalFrames === 0)
        return { joints, base: [0, 0, restHeight, 0, 0, 0, 1] };
      const row = chartData[Math.min(Math.max(0, index), totalFrames - 1)];

      for (const jn of jointNames) {
        const col = mapping[jn];
        /// The model refuses a value that isn't a finite number.
        if (!col || !Number.isFinite(row[col])) continue;
        const raw = row[col];

        if (jn.toLowerCase().includes("finger_joint1")) {
          // Map gripper range → 0-0.044m using auto-detected min/max
          const range = gripperRanges[jn];
          if (range) {
            const t = (raw - range.min) / (range.max - range.min);
            joints[jn] = t * 0.044;
          } else {
            joints[jn] = (raw / 100) * 0.044; // fallback: assume 0-100
          }
        } else if (INSPIRE_JOINT.test(jn)) {
          joints[jn] = inspireJointValue(jn, raw);
        } else if (BRAINCO_JOINT.test(jn)) {
          /// The whole-body datasets' `finger_N` record the hand's closure, not one minus it.
          joints[jn] = braincoJointValue(
            jn,
            /finger_\d+$/.test(col) ? 1 - raw : raw,
          );
        } else if (jn.includes("_dex1_finger_joint_")) {
          joints[jn] =
            DEX1_FINGER_CLOSED +
            (raw / DEX1_MOTOR_TRAVEL) * (DEX1_FINGER_OPEN - DEX1_FINGER_CLOSED);
        } else {
          joints[jn] = jointValue(raw, jointTypes.get(jn), angleUnit);
        }
      }

      if (!basePoseColumns)
        return { joints, base: [0, 0, restHeight, 0, 0, 0, 1] };
      const base = basePoseColumns.map((c) => row[c]);
      /// Some whole-body episodes record no height: 0 throughout.
      if (base[2] === 0) base[2] = restHeight;
      return { joints, base };
    },
    [
      angleUnit,
      basePoseColumns,
      chartData,
      gripperRanges,
      jointNames,
      jointTypes,
      mapping,
      restHeight,
      totalFrames,
    ],
  );

  const pose = useMemo(() => poseAt(frame), [poseAt, frame]);
  const jointValues = pose.joints;
  const basePose = pose.base;

  if (data.flatChartData.length === 0) {
    return (
      <div className="text-fg-muted p-8 text-center">
        No trajectory data available.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 3D Viewport */}
      <div className="flex-1 min-h-0 bg-[var(--surface-0)] rounded-lg overflow-hidden border border-line relative">
        {(episodeLoading || modelLoading) && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--bg)]/80">
            {modelLoading ? (
              <RobotLoader
                robot={robot}
                caption={datasetInfo.robot_type ?? undefined}
              />
            ) : (
              <span className="text-fg text-lg animate-pulse">
                Loading episode {selectedEpisode}…
              </span>
            )}
          </div>
        )}
        {/* Which colour is which arm, when there are two. */}
        {trailMode !== "off" && trailSides.filter(Boolean).length > 1 && (
          <ul
            className="pointer-events-none absolute left-3 top-3 z-[5] flex gap-3 rounded-md bg-[var(--surface-0)]/80 px-2 py-1 text-[11px] text-fg-muted backdrop-blur-sm"
            aria-label="Trail colours"
          >
            {trailSides.map((side, i) =>
              side ? (
                <li key={i} className="flex items-center gap-1.5">
                  <span
                    className="h-0.5 w-3.5 rounded-full"
                    style={{
                      background: `#${trailStyle(side, dark).color.getHexString()}`,
                    }}
                  />
                  {side === "left" ? "Left" : "Right"} {isG1 ? "hand" : "arm"}
                </li>
              ) : null,
            )}
          </ul>
        )}
        <Canvas
          shadows
          frameloop="demand"
          camera={{
            position: isG1
              ? [1.5, 1.0, 1.5]
              : isOpenArm
                ? [0.95 * scale, 0.8 * scale, 0.95 * scale]
                : [0.3 * scale, 0.25 * scale, 0.3 * scale],
            fov: 45,
            near: 0.01,
            far: 100,
          }}
          gl={{
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 0.9,
          }}
        >
          <color attach="background" args={[dark ? "#141c2e" : "#f3f4f6"]} />
          {STUDIO_ENVIRONMENT}
          {/* 3-point studio rig — key is the only shadow caster */}
          <ambientLight intensity={0.12} />
          <directionalLight
            color="#fff2e3"
            position={[3, 5, 3]}
            intensity={1.0}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-camera-near={0.1}
            shadow-camera-far={15}
            shadow-camera-left={-3}
            shadow-camera-right={3}
            shadow-camera-top={3}
            shadow-camera-bottom={-3}
            shadow-bias={-0.0005}
          />
          <directionalLight
            color="#bfd9ff"
            position={[-4, 2, -2]}
            intensity={0.25}
          />
          <directionalLight
            color="#ffffff"
            position={[0, 3, -4]}
            intensity={0.4}
          />
          {/* Ground-shadow catcher — invisible plane receives key-light shadow */}
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, 0.001, 0]}
            receiveShadow
          >
            <planeGeometry args={[10, 10]} />
            <shadowMaterial opacity={0.35} />
          </mesh>
          {customRobot ? (
            <CustomRobotScene
              manifest={customRobot}
              jointValues={jointValues}
              basePose={basePose}
              scale={scale}
              onJointsLoaded={onJointsLoaded}
              fitCamera={fitCameraToRobot}
              highlightJoints={showLimits ? overNow : undefined}
              highlightColor={criticalColor}
            />
          ) : (
            /// In local mode the Hub's model loads only once it is known there is no custom robot.
            (manifest !== undefined || !isLocalMode()) && (
              <RobotScene
                robot={robot}
                usdUrl={usdUrl}
                jointValues={jointValues}
                basePose={basePose}
                onJointsLoaded={onJointsLoaded}
                onTrailSides={setTrailSides}
                poseAt={poseAt}
                totalFrames={totalFrames}
                frame={frame}
                fps={fps}
                trailMode={trailMode}
                dark={dark}
                scale={scale}
              />
            )
          )}
          <Grid
            args={[10, 10]}
            cellSize={isG1 ? 0.5 : 0.2}
            cellThickness={0.5}
            cellColor={dark ? "#334155" : "#d1d5db"}
            sectionSize={isG1 ? 2 : 1}
            sectionThickness={1}
            sectionColor={dark ? "#475569" : "#9ca3af"}
            fadeDistance={isG1 ? 20 : 10}
            infiniteGrid={basePoseColumns !== null}
            position={[-basePose[0] * scale, 0, basePose[1] * scale]}
          />
          <OrbitControls
            makeDefault
            target={isG1 ? [0, 0.5, 0] : [0, 0.8, 0]}
          />
          <PlaybackDriver
            playing={playing}
            fps={fps}
            totalFrames={totalFrames}
            frameRef={frameRef}
            setFrame={setFrame}
          />
        </Canvas>
      </div>

      {/* Controls */}
      <div className="bg-[var(--surface-1)]/90 border-t border-line p-3 space-y-3 shrink-0">
        <ReplayPlaybackBar
          frame={frame}
          totalFrames={totalFrames}
          fps={fps}
          playing={playing}
          onPlayPause={handlePlayPause}
          trailMode={trailMode}
          onTrailModeChange={setTrailMode}
          onFrameChange={handleFrameChange}
          disabled={modelLoading}
          marks={showLimits ? limitMarks : undefined}
          marksLabel="Frames past a joint limit"
        />

        {hasLimits && (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <button
                onClick={() => setShowLimitReport((v) => !v)}
                aria-expanded={showLimitReport}
                className="flex items-center gap-1.5 text-xs text-fg-muted hover:text-fg transition-colors"
              >
                <span
                  className={`transition-transform ${showLimitReport ? "rotate-90" : ""}`}
                >
                  ▶
                </span>
                Joint Limits
                <span
                  className={
                    limitReport.joints.length > 0
                      ? "text-critical-fg"
                      : "text-fg-faint"
                  }
                >
                  {limitReport.joints.length > 0
                    ? `(${limitReport.joints.length} over, in ${limitReport.framesOver} of ${limitReport.totalFrames} frames)`
                    : "(all within limits)"}
                </span>
              </button>
              <Switch
                checked={showLimits}
                onChange={setShowLimits}
                offLabel={<span className="text-xs">Off</span>}
                onLabel={<span className="text-xs">Highlight over limit</span>}
                ariaLabel="Highlight joints past their limits"
              />
            </div>
            {showLimitReport && limitReport.joints.length > 0 && (
              <div className="max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-[var(--surface-1)]">
                    <tr className="text-fg-faint">
                      <th className="text-left font-normal px-1">Joint</th>
                      <th className="text-right font-normal px-1">Frames</th>
                      <th className="text-right font-normal px-1">Worst</th>
                      <th className="text-left font-normal px-1">
                        When (click to go there)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {limitReport.joints.map((v) => (
                      <tr key={v.joint} className="border-t border-line">
                        <td
                          className={`px-1 py-0.5 font-mono ${overNow.has(v.joint) ? "text-critical-fg" : "text-fg-soft"}`}
                        >
                          {v.joint}
                        </td>
                        <td className="px-1 text-right tabular text-fg-muted">
                          {v.frames}
                        </td>
                        <td className="px-1 text-right tabular">
                          <button
                            onClick={() => seekFrame(v.worstFrame)}
                            title={`Frame ${v.worstFrame}`}
                            className="text-critical-fg hover:underline"
                          >
                            {formatOvershoot(v.worst, v.type)}
                          </button>
                        </td>
                        <td className="px-1 py-0.5">
                          <div className="flex flex-wrap gap-1">
                            {v.ranges.slice(0, 8).map((r) => (
                              <button
                                key={r.start}
                                onClick={() => seekFrame(r.start)}
                                className="tabular rounded border border-line bg-fill px-1 text-fg-muted hover:text-fg hover:bg-fill-strong"
                              >
                                {(r.start / fps).toFixed(2)}s
                                {r.end > r.start
                                  ? `–${(r.end / fps).toFixed(2)}s`
                                  : ""}
                              </button>
                            ))}
                            {v.ranges.length > 8 && (
                              <span className="text-fg-faint">
                                +{v.ranges.length - 8} more
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Collapsible joint mapping */}
        <button
          onClick={() => setShowMapping((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-fg-muted hover:text-fg transition-colors"
        >
          <span
            className={`transition-transform ${showMapping ? "rotate-90" : ""}`}
          >
            ▶
          </span>
          Joint Mapping
          <span className="text-fg-faint">
            ({Object.keys(mapping).filter((k) => mapping[k]).length}/
            {jointNames.length} mapped)
          </span>
        </button>

        {showMapping && (
          <div className="flex flex-col lg:flex-row gap-3 lg:gap-4 lg:items-start">
            <div className="space-y-1 shrink-0">
              <label className="text-xs text-fg-muted">Data source</label>
              <div className="flex gap-1 flex-wrap">
                {groupNames.map((name) => (
                  <button
                    key={name}
                    onClick={() => setSelectedGroup(name)}
                    className={`btn ${selectedGroup === name ? "btn-active" : ""}`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-x-auto max-h-48 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-[var(--surface-1)]">
                  <tr className="text-fg-faint">
                    <th className="text-left font-normal px-1">Joint</th>
                    <th className="text-left font-normal px-1">→</th>
                    <th className="text-left font-normal px-1">
                      Dataset Column
                    </th>
                    {hasLimits && (
                      <th className="text-right font-normal px-1">Limits</th>
                    )}
                    <th className="text-right font-normal px-1">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {jointNames.map((jointName) => (
                    <tr key={jointName} className="border-t border-line">
                      <td className="px-1 py-0.5 text-fg-soft font-mono">
                        {jointName}
                      </td>
                      <td className="px-1 text-fg-faint">→</td>
                      <td className="px-1 py-0.5">
                        <select
                          value={mapping[jointName] ?? ""}
                          onChange={(e) =>
                            setMapping((m) => ({
                              ...m,
                              [jointName]: e.target.value,
                            }))
                          }
                          className="bg-[var(--surface-0)] text-fg text-xs rounded px-1 py-0.5 border border-line w-full max-w-[200px]"
                        >
                          <option value="">-- unmapped --</option>
                          {selectedColumns.map((col) => {
                            const label = col.split(SERIES_DELIM).pop() ?? col;
                            return (
                              <option key={col} value={col}>
                                {label}
                              </option>
                            );
                          })}
                        </select>
                      </td>
                      {hasLimits && (
                        <td className="px-1 py-0.5 text-right tabular-nums text-fg-faint font-mono whitespace-nowrap">
                          {limits[jointName]
                            ? `${limits[jointName].lower.toFixed(3)} … ${limits[jointName].upper.toFixed(3)}`
                            : "—"}
                        </td>
                      )}
                      <td
                        className={`px-1 py-0.5 text-right tabular-nums font-mono ${overNow.has(jointName) ? "text-critical-fg" : "text-fg-muted"}`}
                      >
                        {jointValues[jointName] !== undefined
                          ? jointValues[jointName].toFixed(3)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
