import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { cancelJob } from "@/lib/runner";

/** Cancel a queued or running export job. 404 for an unknown id. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!store.jobs.get(id)) {
    return NextResponse.json({ error: "unknown job" }, { status: 404 });
  }
  const cancelled = cancelJob(id);
  return NextResponse.json({ ok: true, cancelled });
}
