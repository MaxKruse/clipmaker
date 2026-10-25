import { NextRequest, NextResponse } from "next/server";
import { normalizeCrop } from "@/lib/crop";
import { enqueue } from "@/lib/runner";
import { store } from "@/lib/store";
import { newId, type ClipSpec } from "@/lib/types";

function toClip(raw: unknown, v: { duration: number; width: number; height: number }): ClipSpec {
  const r = raw as Record<string, any>;
  const start = Number(r?.start);
  let end = Number(r?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error("clip needs numeric start and end");
  if (start < 0) throw new Error("clip start must be >= 0");
  // Allow a small overshoot: the element duration can differ from the probe's.
  end = Math.min(end, v.duration + 0.5);
  if (end - start < 0.2) throw new Error("clip must be at least 0.2s long");
  const formats = (Array.isArray(r.formats) ? r.formats : []).filter(
    (f: unknown) => f === "mp4" || f === "gif",
  );
  if (formats.length === 0) throw new Error("pick at least one format");
  const fps = [25, 30, 60].includes(Number(r.fps)) ? Number(r.fps) : 30;
  const quality = {
    mode: r?.quality?.mode === "manual" ? ("manual" as const) : ("source" as const),
    kbit: Math.max(250, Math.round(Number(r?.quality?.kbit) || 0)),
  };
  const gif = {
    maxMB: [10, 25, 48].includes(Number(r?.gif?.maxMB)) ? Number(r?.gif?.maxMB) : 48,
    maxEdge: [256, 512, 768, 1024].includes(Number(r?.gif?.maxEdge))
      ? Number(r?.gif?.maxEdge)
      : 1024,
  };
  const crop = r?.crop && typeof r.crop === "object" ? normalizeCrop(v.width, v.height, r.crop) : null;
  return {
    id: typeof r?.id === "string" ? r.id : newId(),
    note: typeof r?.note === "string" ? r.note : "",
    start,
    end,
    crop,
    formats,
    audio: Boolean(r?.audio),
    fps,
    quality,
    gif,
  };
}

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
