import { NextRequest, NextResponse } from "next/server";
import { toClip } from "@/lib/clips";
import { groupCombine } from "@/lib/combine";
import { enqueue } from "@/lib/runner";
import { store } from "@/lib/store";
import { newId, type ClipSpec, type Job } from "@/lib/types";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      videoId?: string;
      clips?: unknown[];
      combine?: boolean;
    };
    const v = store.videos.get(body.videoId ?? "");
    if (!v) return NextResponse.json({ error: "unknown video" }, { status: 404 });
    const rawClips = Array.isArray(body.clips) ? body.clips : [];
    if (rawClips.length === 0) return NextResponse.json({ error: "no clips" }, { status: 400 });

    const clips: ClipSpec[] = [];
    for (let i = 0; i < rawClips.length; i++) {
      try {
        clips.push(toClip(rawClips[i], v));
      } catch (e) {
        return NextResponse.json(
          { error: `clip ${i + 1}: ${e instanceof Error ? e.message : e}` },
          { status: 400 },
        );
      }
    }

    // One timestamp per request: a batch stays tied together so the
    // export list renders it in clip order (stable sort on ties).
    const batch = Date.now();
    // "combine" groups same-name clips: each group of 2+ becomes ONE
    // job producing a single mp4 "highlights" file (parts concatenated
    // with fades); singletons export solo, exactly as without combine.
    const groups = body.combine === true ? groupCombine(clips) : clips.map((c) => [c]);
    const ids: string[] = [];
    for (const group of groups) {
      const first = group[0];
      const job: Job = {
        id: newId(),
        videoId: v.id,
        videoName: v.name,
        // A combined job produces the single mp4 highlights file, so its
        // representative clip (display + naming) is mp4-only.
        clip: group.length > 1 ? { ...first, formats: ["mp4"] } : first,
        clipNo: clips.indexOf(first) + 1,
        ...(group.length > 1 ? { clips: group } : {}),
        status: "queued" as const,
        stage: null,
        pct: 0,
        outputs: [],
        createdAt: batch,
      };
      ids.push(job.id);
      enqueue(job);
    }
    return NextResponse.json({ jobIds: ids });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
