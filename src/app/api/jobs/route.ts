import { NextResponse } from "next/server";
import { store } from "@/lib/store";

export async function GET() {
  return NextResponse.json(store.listJobs());
}

/** Remove finished jobs from the list (output files are kept on disk). */
export async function DELETE() {
  store.clearFinishedJobs();
  return NextResponse.json({ ok: true });
}
