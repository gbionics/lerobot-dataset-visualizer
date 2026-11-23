"use client";

import { useEffect, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import URDFLoader from "urdf-loader";
import type { URDFRobot } from "urdf-loader";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import {
  robotFileUrl as fileUrl,
  type RobotManifest,
} from "@/utils/robotManifest";

const Z_UP_TO_Y_UP = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0),
  -Math.PI / 2,
);
const poseQuaternion = new THREE.Quaternion();

/** The meshes a joint moves on its own: its descendants up to the next joint that moves. */
function linkMeshes(object: THREE.Object3D, out: Set<THREE.Mesh>) {
  for (const child of object.children) {
    const joint = child as { isURDFJoint?: boolean; jointType?: string };
    if (joint.isURDFJoint && joint.jointType !== "fixed") continue;
    if (child instanceof THREE.Mesh) out.add(child);
    linkMeshes(child, out);
  }
}

/**
 * The URDF robot described by `manifest`, driven by joint values by name and a base pose
 * (x y z qx qy qz qw). Same contract as the USD scene of the replay viewer.
 */
export default function CustomRobotScene({
  manifest,
  jointValues,
  basePose,
  scale,
  onJointsLoaded,
  fitCamera,
  highlightJoints,
  highlightColor = "#d03b3b",
}: {
  manifest: RobotManifest;
  jointValues: Record<string, number>;
  basePose: number[];
  scale: number;
  onJointsLoaded: (names: string[]) => void;
  fitCamera: (
    robot: THREE.Object3D,
    camera: THREE.Camera,
    controls: unknown,
  ) => void;
  /** Joints whose link is drawn in `highlightColor`. */
  highlightJoints?: ReadonlySet<string>;
  highlightColor?: string;
}) {
  const { scene, camera, controls, invalidate } = useThree();
  const robotRef = useRef<URDFRobot | null>(null);
  const [version, setVersion] = useState(0);
  const pendingFitRef = useRef(false);
  /// Meshes drawn in the highlight, with the material each had.
  const tintedRef = useRef(new Map<THREE.Mesh, THREE.Material>());
  const [tint] = useState(
    () =>
      new THREE.MeshStandardMaterial({
        metalness: 0.25,
        roughness: 0.5,
        emissiveIntensity: 0.35,
      }),
  );
  useEffect(() => () => tint.dispose(), [tint]);

  useEffect(() => {
    let disposed = false;
    const tinted = tintedRef.current;
    const manager = new THREE.LoadingManager();
    // The meshes arrive after the URDF: frame the camera once they are all in.
    manager.onLoad = () => {
      if (disposed) return;
      pendingFitRef.current = true;
      setVersion((v) => v + 1);
    };
    const loader = new URDFLoader(manager);
    const urdfDir = manifest.urdf.split("/").slice(0, -1).join("/");
    loader.workingPath = fileUrl(urdfDir);
    loader.packages = (name: string) =>
      fileUrl(manifest.packages?.[name] ?? name);
    const color = manifest.meshColor ?? "#c8c8d0";
    /// URDFLoader gives a plain Mesh its URDF material after this callback, so a mesh is wrapped.
    const paint = (object: THREE.Object3D) =>
      object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.material = new THREE.MeshStandardMaterial({
            color,
            metalness: 0.25,
            roughness: 0.5,
          });
        }
      });
    loader.loadMeshCb = (url, mgr, _material, onLoad) => {
      const lower = url.toLowerCase();
      const failed = (err: unknown) =>
        onLoad(new THREE.Object3D(), err as Error);
      if (lower.endsWith(".dae")) {
        new ColladaLoader(mgr).load(
          url,
          (collada) => onLoad(collada.scene),
          undefined,
          failed,
        );
      } else if (lower.endsWith(".obj")) {
        new OBJLoader(mgr).load(
          url,
          (obj) => {
            paint(obj);
            onLoad(obj);
          },
          undefined,
          failed,
        );
      } else {
        new STLLoader(mgr).load(
          url,
          (geometry) => {
            const group = new THREE.Group();
            group.add(new THREE.Mesh(geometry));
            paint(group);
            onLoad(group);
          },
          undefined,
          failed,
        );
      }
    };
    loader.load(
      fileUrl(manifest.urdf),
      (robot) => {
        if (disposed) return;
        robotRef.current = robot;
        // The model shows what was recorded, even past a joint's limit.
        for (const joint of Object.values(robot.joints))
          joint.ignoreLimits = true;
        const names = Object.entries(robot.joints)
          .filter(
            ([, joint]) =>
              joint.jointType !== "fixed" &&
              !(joint as { mimicJoint?: string }).mimicJoint,
          )
          .map(([name]) => name);
        scene.add(robot);
        pendingFitRef.current = true;
        setVersion((v) => v + 1);
        onJointsLoaded(names);
        invalidate();
      },
      undefined,
      (err) => {
        if (!disposed) console.error("Failed to load the robot model:", err);
      },
    );
    return () => {
      disposed = true;
      const robot = robotRef.current;
      for (const [mesh, material] of tinted) mesh.material = material;
      tinted.clear();
      if (robot) {
        scene.remove(robot);
        robot.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry?.dispose();
            (child.material as THREE.Material)?.dispose();
          }
        });
        robotRef.current = null;
      }
    };
  }, [manifest, scene, invalidate, onJointsLoaded]);

  useEffect(() => {
    const robot = robotRef.current;
    if (!robot) return;
    const [, , z, qx, qy, qz, qw] = basePose;
    for (const [name, value] of Object.entries(jointValues)) {
      const joint = robot.joints[name];
      if (!joint) continue;
      joint.setJointValue(value);
    }
    robot.position.set(0, 0, 0);
    robot.quaternion.identity();
    robot.scale.setScalar(1);
    robot.updateMatrixWorld(true);
    /// Z-up like the base pose; the robot stays above the origin and the floor moves under it.
    const pose = new THREE.Matrix4().compose(
      new THREE.Vector3(0, manifest.rootLink ? 0 : z * scale, 0),
      new THREE.Quaternion()
        .copy(Z_UP_TO_Y_UP)
        .multiply(poseQuaternion.set(qx, qy, qz, qw)),
      new THREE.Vector3(scale, scale, scale),
    );
    const anchor = manifest.rootLink ? robot.frames[manifest.rootLink] : null;
    if (anchor) {
      // The anchor link is the origin, so the robot hangs from it rather than from its own root.
      const anchorInRobot = robot.matrixWorld
        .clone()
        .invert()
        .multiply(anchor.matrixWorld);
      pose.multiply(anchorInRobot.invert());
    }
    pose.decompose(robot.position, robot.quaternion, robot.scale);
    robot.updateMatrixWorld(true);
    if (pendingFitRef.current) {
      pendingFitRef.current = false;
      fitCamera(robot, camera, controls);
    }
    invalidate();
  }, [
    jointValues,
    basePose,
    scale,
    manifest.rootLink,
    version,
    camera,
    controls,
    fitCamera,
    invalidate,
  ]);

  useEffect(() => {
    tint.color.set(highlightColor);
    tint.emissive.set(highlightColor);
    const robot = robotRef.current;
    if (!robot) return;
    const wanted = new Set<THREE.Mesh>();
    for (const name of highlightJoints ?? []) {
      const joint = robot.joints[name];
      if (joint) linkMeshes(joint, wanted);
    }
    const tinted = tintedRef.current;
    for (const [mesh, material] of tinted) {
      if (wanted.has(mesh)) continue;
      mesh.material = material;
      tinted.delete(mesh);
    }
    for (const mesh of wanted) {
      if (tinted.has(mesh)) continue;
      tinted.set(mesh, mesh.material as THREE.Material);
      mesh.material = tint;
    }
    invalidate();
  }, [highlightJoints, highlightColor, tint, version, invalidate]);

  return null;
}
