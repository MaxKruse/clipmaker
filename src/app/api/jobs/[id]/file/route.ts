import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { OUT_DIR, store } from "@/lib/store";

/** Download a finished job's output: ?k=mp4|gif picks the output kind. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = store.jobs.get(id);
  if (!job) return NextResponse.json({ error: "unknown job" }, { status: 404 });
  const kind = req.nextUrl.searchParams.get("k");
  const out = job.outputs.find((o) => o.kind === kind);
  if (!out) return NextResponse.json({ error: "no such output" }, { status: 404 });
  const file = path.join(OUT_DIR, job.videoId, out.name);
  if (!fs.existsSync(file)) return NextResponse.json({ error: "file missing on disk" }, { status: 404 });
  const stream = Readable.toWeb(fs.createReadStream(file)) as unknown as ReadableStream;
  return new Response(stream, {
    headers: {
      "content-type": out.name.endsWith(".gif") ? "image/gif" : "video/mp4",
      "content-disposition": `attachment; filename="${encodeURIComponent(out.name)}"`,
      "content-length": String(fs.statSync(file).size),
    },
  });
}
