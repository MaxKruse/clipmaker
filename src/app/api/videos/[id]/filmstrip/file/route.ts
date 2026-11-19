import { NextRequest, NextResponse } from "next/server";
import { readThumb } from "@/lib/filmstrip";
import { store } from "@/lib/store";

/** One cached filmstrip frame (t = the absolute second it was sampled at). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = store.videos.get(id);
  if (!v) return NextResponse.json({ error: "unknown video" }, { status: 404 });
  const t = Number(new URL(req.url).searchParams.get("t"));
  const buf = await readThumb(id, t);
  if (!buf) return NextResponse.json({ error: "frame not ready" }, { status: 404 });
  return new Response(new Uint8Array(buf), {
    headers: { "content-type": "image/jpeg", "cache-control": "no-store" },
  });
}
