import { NextRequest, NextResponse } from "next/server";
import { toClip } from "@/lib/clips";
import { combineKey, groupCombine } from "@/lib/combine";
import { enqueue } from "@/lib/runner";
import { store } from "@/lib/store";
import { newId, type ClipSpec, type Job } from "@/lib/types";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      videoId?: string;
      clips?: unknown[];
      /** Note keys (trimmed + lowercased) of the groups that get a
       * combined compilation mp4 job, in addition to their parts. */
      combine?: unknown;
      /** 1-based queue positions of the ticked clips, parallel to
       * `clips` (0/missing = fall back to the subset index). */
      nos?: unknown;
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
    // The 1-based queue positions of the ticked clips (sent by the client);
    // anything that is not a valid position falls back to the subset index.
    const nos = Array.isArray(body.nos) ? body.nos : null;
    const clipNoFor = (i: number): number => {
      const n = nos?.[i];
      return typeof n === "number" && Number.isInteger(n) && n >= 1 ? n : i + 1;
    };


    // One timestamp per request: a batch stays tied together so the
    // export list renders it in clip order (stable sort on ties).
    const batch = Date.now();
    const ids: string[] = [];

    // Every selected clip gets its own job. A combined compilation file
    // is an ADDITION to its parts, never a replacement: the parts are
    // the individual exports the user ticked in the plan modal.
    for (let i = 0; i < clips.length; i++) {
      const job: Job = {
        id: newId(),
        videoId: v.id,
        videoName: v.name,
        clip: clips[i],
        clipNo: clipNoFor(i),
        status: "queued" as const,
        stage: null,
        pct: 0,
        outputs: [],
        createdAt: batch,
      };
      ids.push(job.id);
      enqueue(job);
    }

    // "combine" carries the note keys of the groups that get ONE
    // additional combined job (parts concatenated with 0.5s fades into a
    // single mp4 in Compilations/, plus a preview in Compilations/Preview/).
    // A group needs 2+ parts - a requested singleton is already covered by
    // its solo job above.
    const combineKeys = new Set(
      Array.isArray(body.combine)
        ? body.combine.map((k) => combineKey(String(k))).filter((k) => k !== "")
        : [],
    );
    for (const group of combineKeys.size > 0 ? groupCombine(clips) : []) {
      if (group.length < 2) continue;
      if (!combineKeys.has(combineKey(group[0].note))) continue;
      const first = group[0];
      const job: Job = {
        id: newId(),
        videoId: v.id,
        videoName: v.name,
        // A combined job produces the single mp4 compilation file, so its
        // representative clip (display + naming) is mp4-only.
        clip: { ...first, formats: ["mp4"] },
        clipNo: clipNoFor(clips.indexOf(first)),
        clips: group,
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
