import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { resolve } from "path";

// Serves the robot manifest. Only in local mode; the path comes from the environment, never the request.
const MANIFEST_PATH = resolve(
  process.cwd(),
  process.env.ROBOT_MANIFEST || ".robot/robot.json",
);

export async function GET(): Promise<NextResponse> {
  if (!process.env.LOCAL_DATASET_PATH) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const text = await readFile(MANIFEST_PATH, "utf8").catch(() => null);
  if (text === null) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return new NextResponse(text, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
