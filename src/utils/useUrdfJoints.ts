import { useEffect, useState } from "react";
import { parseUrdfJoints, type UrdfJoint } from "@/utils/jointLimits";
import { robotFileUrl, type RobotManifest } from "@/utils/robotManifest";

const urdfJointsCache = new Map<string, Promise<UrdfJoint[] | null>>();

/** The joints of the manifest's URDF; null when it can't be read. */
export function loadUrdfJoints(
  manifest: RobotManifest,
): Promise<UrdfJoint[] | null> {
  const url = robotFileUrl(manifest.urdf);
  let loading = urdfJointsCache.get(url);
  if (!loading) {
    loading = fetch(url)
      .then((res) => (res.ok ? res.text() : null))
      .then((xml) => (xml === null ? null : parseUrdfJoints(xml)))
      .catch(() => null);
    urdfJointsCache.set(url, loading);
  }
  return loading;
}

/** undefined while loading, then the joints or null. */
export function useUrdfJoints(
  manifest: RobotManifest | null | undefined,
): UrdfJoint[] | null | undefined {
  const [state, setState] = useState<{
    manifest: RobotManifest | null | undefined;
    joints: UrdfJoint[] | null | undefined;
  }>({ manifest: undefined, joints: undefined });
  useEffect(() => {
    if (!manifest) return;
    let live = true;
    void loadUrdfJoints(manifest).then(
      (joints) => live && setState({ manifest, joints }),
    );
    return () => {
      live = false;
    };
  }, [manifest]);
  if (!manifest) return manifest === null ? null : undefined;
  return state.manifest === manifest ? state.joints : undefined;
}
