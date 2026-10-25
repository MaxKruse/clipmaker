import { NextRequest, NextResponse } from "next/server";
import { toClip } from "@/lib/clips";
import { store } from "@/lib/store";

/** A video's project file: its persisted clip list. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!store.videos.has(id)) return NextResponse.json({ error: "unknown video" }, { status: 404 });
  return NextResponse.json({ clips: store.getClips(id) });
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
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
