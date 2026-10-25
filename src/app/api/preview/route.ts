import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { buildPreviewArgs } from "@/lib/args";
import { normalizeCrop, type CropBox } from "@/lib/crop";
import { findBin, run } from "@/lib/ffmpeg";
import { TMP_DIR, store } from "@/lib/store";

/** Single cropped jpeg frame at the given time - the live crop preview. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { videoId?: string; time?: number; crop?: CropBox };
    const v = store.videos.get(body.videoId ?? "");
    if (!v) return NextResponse.json({ error: "unknown video" }, { status: 404 });
    const time = Math.min(Math.max(0, Number(body.time) || 0), Math.max(0, v.duration - 0.05));
    const crop = body.crop ? normalizeCrop(v.width, v.height, body.crop) : null;
    const out = path.join(TMP_DIR, `preview-${v.id}.jpg`);
    fs.mkdirSync(TMP_DIR, { recursive: true });
    await run(findBin("ffmpeg"), buildPreviewArgs({ in: v.path, out, time, maxW: 480, crop }), 30_000);
    const buf = await fs.promises.readFile(out);
    return new Response(new Uint8Array(buf), {
      headers: { "content-type": "image/jpeg", "cache-control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
