import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { timestampsForVideo } from "@/lib/clipsTxt";
import { OUT_DIR, store } from "@/lib/store";

/**
 * Save the video's clips to out/<videoId>/timestamps.txt: one
 * `<start> - <end> <note?>` line per clip, no `# header` line. Overwrites
 * the previous file, so it always mirrors the current clip list.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = store.videos.get(id);
  if (!v) return NextResponse.json({ error: "unknown video" }, { status: 404 });
  // id is an app-generated session id, but never build a path from it blindly.
  if (!id || id.includes("/") || id.includes("\\") || id.includes("..")) {
    return NextResponse.json({ error: "bad video id" }, { status: 400 });
  }
  const dir = path.join(OUT_DIR, id);
  const file = path.join(dir, "timestamps.txt");
  try {
    fs.mkdirSync(dir, { recursive: true });
    const clips = store.getClips(id);
    fs.writeFileSync(file, timestampsForVideo(clips));
    return NextResponse.json({ ok: true, path: `out/${id}/timestamps.txt`, count: clips.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
