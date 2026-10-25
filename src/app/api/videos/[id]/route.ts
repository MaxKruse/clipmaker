import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = store.videos.get(id);
  if (!v) return NextResponse.json({ error: "unknown video" }, { status: 404 });
  store.removeVideo(id);
  return NextResponse.json({ ok: true });
}
