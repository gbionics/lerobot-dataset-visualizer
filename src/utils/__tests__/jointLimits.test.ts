import { describe, expect, test } from "bun:test";
import {
  episodeLimitReport,
  findLimitViolations,
  framesOverRanges,
  jointLimitsOf,
  jointsOverAt,
  parseUrdfJoints,
} from "@/utils/jointLimits";

const URDF = `<?xml version="1.0"?>
<robot name="mybot">
  <!-- <joint name="commented" type="revolute"><limit lower="0" upper="1"/></joint> -->
  <joint name="joint_a" type="revolute">
    <parent link="base"/><child link="a"/>
    <limit lower="-1.0" upper="1.0" effort="1" velocity="1"/>
  </joint>
  <joint name="joint_b" type="prismatic">
    <limit upper='0.05' lower='0'/>
  </joint>
  <joint name="joint_c" type="continuous"/>
  <joint name="joint_d" type="revolute">
    <mimic joint="joint_a"/>
    <limit lower="-1" upper="1"/>
  </joint>
  <joint name="joint_e" type="revolute"><limit lower="0" upper="0"/></joint>
  <joint name="fixed_f" type="fixed"/>
  <transmission name="t"><joint name="joint_a"/></transmission>
</robot>`;

describe("parseUrdfJoints / jointLimitsOf", () => {
  test("keeps driven revolute and prismatic joints with a range", () => {
    const joints = parseUrdfJoints(URDF);
    expect(joints.map((j) => j.name)).toEqual([
      "joint_a",
      "joint_b",
      "joint_c",
      "joint_d",
      "joint_e",
      "fixed_f",
    ]);
    expect(jointLimitsOf(joints)).toEqual({
      joint_a: { type: "revolute", lower: -1, upper: 1 },
      joint_b: { type: "prismatic", lower: 0, upper: 0.05 },
    });
  });
});

describe("findLimitViolations", () => {
  const limits = jointLimitsOf(parseUrdfJoints(URDF));
  const mapping = { joint_a: "s | a", joint_b: "s | b" };

  test("exact limits: on the limit is within, past it is not", () => {
    const rows = [1, 1.2, 1.3, 0.5, -1.1, -1].map((a) => ({
      "s | a": a,
      "s | b": 0.01,
    }));
    const report = findLimitViolations(rows, mapping, limits, "radians");
    expect(report.framesOver).toBe(3);
    expect(report.joints).toHaveLength(1);
    const v = report.joints[0];
    expect(v.joint).toBe("joint_a");
    expect(v.ranges).toEqual([
      { start: 1, end: 2 },
      { start: 4, end: 4 },
    ]);
    expect(v.worst).toBeCloseTo(0.3);
    expect(v.worstFrame).toBe(2);
    expect([...jointsOverAt(report, 2)]).toEqual(["joint_a"]);
    expect(jointsOverAt(report, 3).size).toBe(0);
  });

  test("converts angles by unit but reads prismatic values as metres", () => {
    const rows = [{ "s | a": 90, "s | b": 0.06 }];
    const report = findLimitViolations(rows, mapping, limits, "degrees");
    expect(report.joints.map((v) => v.joint).sort()).toEqual([
      "joint_a",
      "joint_b",
    ]);
    const a = report.joints.find((v) => v.joint === "joint_a")!;
    expect(a.worst).toBeCloseTo(Math.PI / 2 - 1);
  });

  test("merges frame ranges across joints", () => {
    const rows = [
      { "s | a": 2, "s | b": 0 },
      { "s | a": 0, "s | b": 1 },
      { "s | a": 0, "s | b": 0 },
      { "s | a": 2, "s | b": 0 },
    ];
    const report = findLimitViolations(rows, mapping, limits, "radians");
    expect(framesOverRanges(report)).toEqual([
      { start: 0, end: 1 },
      { start: 3, end: 3 },
    ]);
  });
});

describe("episodeLimitReport", () => {
  test("maps from the state feature, with the manifest's joints", () => {
    const rows = [
      {
        "observation.state | joint_a": 0,
        "observation.state | slider.pos": 0.1,
        "action | joint_a": 5,
      },
    ];
    const report = episodeLimitReport(rows, parseUrdfJoints(URDF), {
      urdf: "mybot.urdf",
      joints: { joint_b: "slider.pos" },
    });
    expect(report.joints.map((v) => v.joint)).toEqual(["joint_b"]);
  });
});
