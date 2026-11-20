import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { resolve } from "path";
import { Readable } from "stream";
import { resolveInside } from "@/utils/safePath";

// Serves the custom robot model (URDF, meshes, robot.json) from ROBOT_MODEL_DIR. Only in local mode,
// and only model file types: the directory can hold anything else.
const LOCAL_DATASET_PATH = process.env.LOCAL_DATASET_PATH;
const ROBOT_MODEL_DIR = resolve(
  process.cwd(),
  process.env.ROBOT_MODEL_DIR || ".robot",
);

const EXT_CONTENT_TYPE: Record<string, string> = {
  json: "application/json",
  urdf: "application/xml",
  xml: "application/xml",
  stl: "model/stl",
  dae: "model/vnd.collada+xml",
  obj: "text/plain",
  mtl: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  if (!LOCAL_DATASET_PATH) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const segments = (await params).path.map((s) => decodeURIComponent(s));
  const ext = segments.at(-1)?.split(".").pop()?.toLowerCase() ?? "";
  const contentType = EXT_CONTENT_TYPE[ext];
  if (!contentType) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const target = await resolveInside(ROBOT_MODEL_DIR, segments);
  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const info = await stat(target).catch(() => null);
  if (!info?.isFile()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = Readable.toWeb(
    createReadStream(target),
  ) as unknown as ReadableStream<Uint8Array>;
  return new NextResponse(info.size > 0 ? body : null, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(info.size),
      "Cache-Control": "no-store",
    },
  });
}
