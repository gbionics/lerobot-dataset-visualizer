import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import { join, resolve, sep } from "path";

const LOCAL_DATASET_PATH = process.env.LOCAL_DATASET_PATH;

const EXT_CONTENT_TYPE: Record<string, string> = {
  json: "application/json",
  jsonl: "application/x-ndjson",
  parquet: "application/octet-stream",
  mp4: "video/mp4",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  if (!LOCAL_DATASET_PATH) {
    return NextResponse.json(
      { error: "Local dataset mode not enabled" },
      { status: 404 },
    );
  }

  const pathSegments = (await params).path.map((s) => decodeURIComponent(s));

  // Validate: all segments must be safe (no ".." or absolute paths)
  if (pathSegments.some((s) => s === ".." || s.startsWith("/"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const base = resolve(process.cwd(), LOCAL_DATASET_PATH);
  const target = resolve(join(base, ...pathSegments));

  // Secondary path-traversal guard
  const normalizedBase = base.endsWith(sep) ? base : base + sep;
  if (!target.startsWith(normalizedBase) && target !== base) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let size: number;
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error("not a file");
    size = info.size;
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ext = target.split(".").pop()?.toLowerCase() ?? "";
  const contentType = EXT_CONTENT_TYPE[ext] ?? "application/octet-stream";

  const stream = (start: number, end: number) =>
    Readable.toWeb(
      createReadStream(target, { start, end }),
    ) as unknown as ReadableStream<Uint8Array>;

  // Range requests are needed for video seeking and for parquet range reads
  const rangeHeader = request.headers.get("range");
  const match = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader) : null;
  if (match && (match[1] || match[2]) && size > 0) {
    let start: number;
    let end: number;
    if (match[1]) {
      start = parseInt(match[1], 10);
      end = match[2] ? Math.min(parseInt(match[2], 10), size - 1) : size - 1;
    } else {
      // Suffix range: the last N bytes
      start = Math.max(size - parseInt(match[2], 10), 0);
      end = size - 1;
    }
    if (start > end || start >= size) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }
    return new NextResponse(stream(start, end), {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
      },
    });
  }

  return new NextResponse(size > 0 ? stream(0, size - 1) : null, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Content-Length": String(size),
    },
  });
}
