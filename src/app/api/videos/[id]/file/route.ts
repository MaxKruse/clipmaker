import fs from "node:fs";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";

const MIME: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  webm: "video/webm",
  ts: "video/mp2t",
  avi: "video/x-msvideo",
};

function mime(p: string): string {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

/** Stream the source video to the <video> element, with byte-range support. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = store.videos.get(id);
  if (!v) return NextResponse.json({ error: "unknown video" }, { status: 404 });
  let size: number;
  try {
    size = (await fs.promises.stat(v.path)).size;
  } catch {
    return NextResponse.json({ error: "file missing on disk" }, { status: 404 });
  }

  const headers: Record<string, string> = {
    "content-type": mime(v.path),
    "accept-ranges": "bytes",
    "cache-control": "no-store",
  };

  const range = req.headers.get("range");
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    if (!m) {
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    }
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    }
    const stream = Readable.toWeb(fs.createReadStream(v.path, { start, end })) as unknown as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: {
        ...headers,
        "content-length": String(end - start + 1),
        "content-range": `bytes ${start}-${end}/${size}`,
      },
    });
  }

  const stream = Readable.toWeb(fs.createReadStream(v.path)) as unknown as ReadableStream;
  return new Response(stream, { status: 200, headers: { ...headers, "content-length": String(size) } });
}
