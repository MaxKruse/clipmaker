import { NextRequest, NextResponse } from "next/server";
import { filmstrip, filmstripFrames } from "@/lib/filmstrip";
import { store } from "@/lib/store";

/**
 * Current filmstrip status for a video; the first call starts generation
 * (fast-seek one frame per planned time, cached on disk, single-flight).
 * While generating, `ready` is false and `done`/`total` track progress; the
 * client polls until ready, then reads the frame list.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = store.videos.get(id);
  if (!v) return NextResponse.json({ error: "unknown video" }, { status: 404 });
  const st = filmstrip(v);
  const frames = st.ready
    ? filmstripFrames(v).map((f) => ({ time: f.time, src: `/api/videos/${id}/filmstrip/file?t=${f.time}` }))
    : [];
  return NextResponse.json({ ready: st.ready, interval: st.interval, total: st.total, done: st.done, frames });
}
