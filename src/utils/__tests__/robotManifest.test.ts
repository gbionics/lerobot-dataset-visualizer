import { describe, expect, test } from "bun:test";
import {
  manifestJointMapping,
  parseRobotManifest,
  robotManifestMatches,
} from "../robotManifest";

describe("parseRobotManifest", () => {
  test("requires a urdf path", () => {
    expect(parseRobotManifest({})).toBeNull();
    expect(parseRobotManifest(null)).toBeNull();
    expect(parseRobotManifest({ urdf: "" })).toBeNull();
  });

  test("keeps valid fields and drops invalid ones", () => {
    const m = parseRobotManifest({
      urdf: "model.urdf",
      scale: -1,
      joints: { a: "x", b: 3 },
      match: ["bot"],
    });
    expect(m).toEqual({ urdf: "model.urdf", match: ["bot"] });
  });
});

describe("robotManifestMatches", () => {
  test("matches robot_type case-insensitively by substring", () => {
    const m = { urdf: "m.urdf", match: ["Bot"] };
    expect(robotManifestMatches(m, "my_bot_v2")).toBe(true);
    expect(robotManifestMatches(m, "other")).toBe(false);
    expect(robotManifestMatches(m, null)).toBe(false);
  });

  test("matches everything without a match list", () => {
    expect(robotManifestMatches({ urdf: "m.urdf" }, null)).toBe(true);
  });
});

describe("manifestJointMapping", () => {
  test("maps joints to columns by full key or suffix", () => {
    const m = {
      urdf: "m.urdf",
      joints: { j1: "alpha", j2: "beta", j3: "gone" },
    };
    const keys = ["observation.state | alpha", "beta"];
    expect(manifestJointMapping(m, keys, " | ")).toEqual({
      j1: "observation.state | alpha",
      j2: "beta",
    });
  });
});
