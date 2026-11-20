import { useEffect, useState } from "react";
import { isLocalMode } from "@/utils/localDatasetShared";
import {
  ROBOT_MANIFEST_URL,
  parseRobotManifest,
  type RobotManifest,
} from "@/utils/robotManifest";

let manifestPromise: Promise<RobotManifest | null> | null = null;

/** The custom robot's manifest; null when local mode is off or there is none. */
function loadRobotManifest(): Promise<RobotManifest | null> {
  if (!isLocalMode()) return Promise.resolve(null);
  manifestPromise ??= fetch(ROBOT_MANIFEST_URL, { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then(parseRobotManifest)
    .catch(() => null);
  return manifestPromise;
}

/** undefined while loading, then the manifest or null. */
export function useRobotManifest(): RobotManifest | null | undefined {
  const [manifest, setManifest] = useState<RobotManifest | null | undefined>(
    undefined,
  );
  useEffect(() => {
    let live = true;
    void loadRobotManifest().then((m) => live && setManifest(m));
    return () => {
      live = false;
    };
  }, []);
  return manifest;
}
