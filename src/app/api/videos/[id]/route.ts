import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { removeThumbsForVideo } from "@/lib/filmstrip";
import { cancelJob } from "@/lib/runner";
import { isActiveJob } from "@/lib/jobs";
import { OUT_DIR, store } from "@/lib/store";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = store.videos.get(id);
  if (!v) return NextResponse.json({ error: "unknown video" }, { status: 404 });
  // Stop the video's queued/running exports before the video goes: queued
  // jobs settle at once, running ones are killed and settle later - the
  // late store update is a no-op once the video is gone (store.updateJob).
  for (const j of store.jobs.values()) {
    if (j.videoId === id && isActiveJob(j)) cancelJob(j.id);
  }
  store.removeVideo(id);
  store.removeJobsForVideo(id);
  // The video's per-id runtime dirs go with it: its export files (which
  // can be several GB) and its filmstrip cache. The uploads dir is
  // already handled by removeVideo for uploaded sources.
  fs.rmSync(path.join(OUT_DIR, id), { recursive: true, force: true });
  removeThumbsForVideo(id);
  return NextResponse.json({ ok: true });
}
