"use client";

import { humanSize } from "@/lib/human";
import type { Job } from "@/lib/types";

const STATUS_STYLE: Record<Job["status"], string> = {
  queued: "border-border text-muted",
  running: "border-accent/50 text-accent",
  done: "border-ok/50 text-ok",
  error: "border-danger/50 text-danger",
};

export function JobsPanel({ jobs, onClear }: { jobs: Job[]; onClear: () => void }) {
  if (jobs.length === 0) return null;
  const hasFinished = jobs.some((j) => j.status === "done" || j.status === "error");
  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="label">Exports</span>
        {hasFinished && (
          <button className="btn btn-sm" onClick={onClear}>
            clear finished
          </button>
        )}
      </div>
      <div className="flex flex-col gap-3">
        {jobs.map((j) => (
          <div key={j.id} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted">#{j.clipNo}</span>
              <span className="min-w-0 flex-1 truncate text-sm">{j.clip.note || "unnamed clip"}</span>
              <span className={`rounded-full border bg-panel2 px-2 py-0.5 font-mono text-[11px] ${STATUS_STYLE[j.status]}`}>
                {j.status}
              </span>
            </div>
            {j.status === "queued" && (
              <span className="font-mono text-[11px] text-muted">waiting in queue</span>
            )}
            {j.status === "running" && (
              <>
                <div className="h-1.5 w-full overflow-hidden rounded bg-track">
                  <div
                    className="h-full bg-accent transition-[width] duration-300"
                    style={{ width: `${Math.round(j.pct * 100)}%` }}
                  />
                </div>
                {j.stage && <span className="truncate font-mono text-[11px] text-muted">{j.stage}</span>}
              </>
            )}
            {j.status === "error" && j.error && (
              <span className="text-xs break-words text-danger">{j.error}</span>
            )}
            {j.warning && <span className="text-xs text-warn">{j.warning}</span>}
            {j.outputs.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {j.outputs.map((o) => (
                  <a key={o.kind} className="btn btn-sm" href={`/api/jobs/${j.id}/file?k=${o.kind}`} download>
                    <span className="font-mono">{o.name}</span>
                    <span className="text-muted">{humanSize(o.size)}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
