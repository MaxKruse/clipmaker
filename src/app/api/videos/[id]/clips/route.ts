import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { timestampsForVideo } from "@/lib/clipsTxt";
import { toClip } from "@/lib/clips";
import { OUT_DIR, store } from "@/lib/store";
import type { ClipSpec } from "@/lib/types";

/**
 * A video's project file: its persisted clip list. Clips are re-run
 * through toClip so old rows (e.g. the pre-avif `gif` key) come back in
 * canonical shape; a clip that no longer parses is kept as-is rather
 * than dropped.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = store.videos.get(id);
  if (!v) return NextResponse.json({ error: "unknown video" }, { status: 404 });
  const clips = store.getClips(id).map((c) => {
    try {
      return toClip(c, v);
    } catch {
      return c;
    }
  });
  return NextResponse.json({ clips });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = store.videos.get(id);
  if (!v) return NextResponse.json({ error: "unknown video" }, { status: 404 });
  try {
    const body = (await req.json()) as { clips?: unknown };
    const raw = Array.isArray(body.clips) ? body.clips : [];
    if (raw.length > 500) return NextResponse.json({ error: "too many clips" }, { status: 400 });
    const clips = raw.map((c, i) => {
      try {
        return toClip(c, v);
      } catch (e) {
        throw new Error(`clip ${i + 1}: ${e instanceof Error ? e.message : e}`);
      }
    });
    store.setClips(id, clips);
    saveTimestamps(id, clips);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

/**
 * Mirror the saved clip list to out/<videoId>/timestamps.txt (the
 * auto-saved "download timestamps" - no button anymore): every clip save
 * rewrites the file, an empty list deletes it. Best-effort by contract:
 * a write problem must never fail the clip save itself.
 */
function saveTimestamps(id: string, clips: ClipSpec[]) {
  if (!id || id.includes("/") || id.includes("\\") || id.includes("..")) return;
  try {
    const dir = path.join(OUT_DIR, id);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "timestamps.txt");
    if (clips.length === 0) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, timestampsForVideo(clips));
  } catch {
    // the clip save already succeeded; the mirror is best-effort.
  }
}
