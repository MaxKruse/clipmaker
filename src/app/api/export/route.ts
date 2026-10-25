import { NextRequest, NextResponse } from "next/server";
import { toClip } from "@/lib/clips";
import { enqueue } from "@/lib/runner";
import { store } from "@/lib/store";
import { newId, type ClipSpec } from "@/lib/types";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { videoId?: string; clips?: unknown[] };
    const v = store.videos.get(body.videoId ?? "");
    if (!v) return NextResponse.json({ error: "unknown video" }, { status: 404 });
    const rawClips = Array.isArray(body.clips) ? body.clips : [];
    if (rawClips.length === 0) return NextResponse.json({ error: "no clips" }, { status: 400 });

    const ids: string[] = [];
    for (let i = 0; i < rawClips.length; i++) {
      let clip: ClipSpec;
      try {
        clip = toClip(rawClips[i], v);
      } catch (e) {
        return NextResponse.json(
          { error: `clip ${i + 1}: ${e instanceof Error ? e.message : e}` },
          { status: 400 },
        );
      }
      const job = {
        id: newId(),
        videoId: v.id,
        videoName: v.name,
        clip,
        clipNo: i + 1,
        status: "queued" as const,
        stage: null,
        pct: 0,
        outputs: [],
        createdAt: Date.now(),
      };
      ids.push(job.id);
      enqueue(job);
    }
    return NextResponse.json({ jobIds: ids });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
