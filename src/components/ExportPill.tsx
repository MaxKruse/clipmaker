"use client";

import type { Job } from "@/lib/types";
import { Spinner } from "./ExportModal";

/**
 * Minimized export state: a small fixed pill (bottom-right, out of the
 * layout flow) that tracks the batch and re-opens the front-and-center
 * modal. Replaces the old always-on job list panel.
 */
export function ExportPill({ jobs, onView }: { jobs: Job[]; onView: () => void }) {
  if (jobs.length === 0) return null;
  const active = jobs.filter((j) => j.status === "queued" || j.status === "running").length;
  const done = jobs.filter((j) => j.status === "done").length;
  const failed = jobs.filter((j) => j.status === "error").length;
  const label = active > 0 ? `${active} exporting` : failed > 0 ? `${failed} failed` : `${done} done`;
  return (
    <button
      onClick={onView}
      className="panel fixed right-3 bottom-3 z-40 flex items-center gap-2 border-accent/40 bg-panel px-3 py-2 shadow-xl transition-colors hover:border-accent"
    >
      {active > 0 ? (
        <Spinner />
      ) : failed > 0 ? (
        <span className="flex size-4 items-center justify-center rounded-full bg-danger/20 font-mono text-[10px] font-bold text-danger">!</span>
      ) : (
        <span className="flex size-4 items-center justify-center rounded-full bg-ok/20 font-mono text-[10px] font-bold text-ok">✓</span>
      )}
      <span className="font-mono text-xs">{label}</span>
      <span className="text-xs text-muted">show</span>
    </button>
  );
}
