import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { findOutput } from "@/lib/jobs";
import { OUT_DIR, store } from "@/lib/store";
import { dateFromVideoId } from "@/lib/vodDate";

/** Download a finished job's output: ?k=mp4|gif|avif picks the kind, ?t=full|sharable the tier. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = store.jobs.get(id);
  if (!job) return NextResponse.json({ error: "unknown job" }, { status: 404 });
  const kind = req.nextUrl.searchParams.get("k");
  const out = findOutput(job.outputs ?? [], kind ?? "", req.nextUrl.searchParams.get("t") ?? undefined);
  if (!out) return NextResponse.json({ error: "no such output" }, { status: 404 });
  // out.name is relative to the video's export dir, which for dated
  // videos sits in a subfolder of just that date.
  const file = path.join(OUT_DIR, job.videoId, dateFromVideoId(job.videoId) ?? "", out.name);
  if (!fs.existsSync(file)) return NextResponse.json({ error: "file missing on disk" }, { status: 404 });
  const type = out.name.endsWith(".avif")
    ? "image/avif"
    : out.name.endsWith(".gif")
      ? "image/gif"
      : "video/mp4";
  const stream = Readable.toWeb(fs.createReadStream(file)) as unknown as ReadableStream;
  return new Response(stream, {
    headers: {
      "content-type": type,
      "content-disposition": `attachment; filename="${encodeURIComponent(path.basename(out.name))}"`,
      "content-length": String(fs.statSync(file).size),
    },
  });
}
