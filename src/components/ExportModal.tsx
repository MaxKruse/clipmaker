"use client";

import { humanSize } from "@/lib/human";
import type { Job } from "@/lib/types";

export function Spinner({ className = "size-4" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin text-accent`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-90" fill="currentColor" d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7V2z" />
    </svg>
  );
}

function StatusChip({ job }: { job: Job }) {
  if (job.status === "running") return <Spinner />;
  if (job.status === "queued")
    return (
      <span className="rounded-full border border-border bg-panel px-2 py-0.5 font-mono text-[11px] text-muted">
        queued
      </span>
    );
  if (job.status === "done")
    return (
      <span className="rounded-full border border-ok/50 bg-ok/10 px-2 py-0.5 font-mono text-[11px] text-ok">
        done
      </span>
    );
  return (
    <span className="rounded-full border border-danger/50 bg-danger/10 px-2 py-0.5 font-mono text-[11px] text-danger">
      failed
    </span>
  );
}

function JobRow({ job }: { job: Job }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-panel2 p-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-muted">#{job.clipNo}</span>
        <span className="min-w-0 flex-1 truncate text-sm">{job.clip.note || "unnamed clip"}</span>
        {job.clip.formats.map((f) => (
          <span key={f} className="chip">
            {f.toUpperCase()}
          </span>
        ))}
        <StatusChip job={job} />
      </div>
      {job.status === "running" && (
        <div className="flex flex-col gap-1.5">
          <div className="h-2 w-full overflow-hidden rounded bg-track">
            <div
              className="h-full rounded bg-accent transition-[width] duration-300"
              style={{ width: `${Math.max(2, Math.round(job.pct * 100))}%` }}
            />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            {job.stage && <span className="min-w-0 truncate font-mono text-[11px] text-muted">{job.stage}</span>}
            <span className="font-mono text-[11px] text-muted">{Math.round(job.pct * 100)}%</span>
          </div>
        </div>
      )}
      {job.status === "queued" && <span className="font-mono text-[11px] text-muted">waiting in queue</span>}
      {job.status === "error" && job.error && (
        <span className="break-words text-xs text-danger">{job.error}</span>
      )}
      {job.warning && <span className="break-words text-xs text-warn">{job.warning}</span>}
      {job.outputs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {job.outputs.map((o) => {
            const tier = o.tier ?? (o.name.includes("sharable") ? "sharable" : "full");
            return (
              <a key={o.name} className="btn btn-sm" href={`/api/jobs/${job.id}/file?k=${o.kind}`} download>
                {tier === "sharable" && <span className="chip">sharable</span>}
                <span className="font-mono">{o.name.split("/").pop()}</span>
                <span className="text-muted">{humanSize(o.size)}</span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface Props {
  jobs: Job[];
  onClose: () => void;
  /** Present while any job is still moving: the modal offers minimize, not close. */
  onMinimize?: () => void;
  onClear?: () => void;
}

/**
 * Front-and-center export view: takes over the screen while a batch is
 * running (spinner, per-clip progress bars, stage text, overall bar) and
 * stays open with the finished outputs until the user closes it.
 */
export function ExportModal({ jobs, onClose, onMinimize, onClear }: Props) {
  if (jobs.length === 0) return null;
  const active = jobs.filter((j) => j.status === "queued" || j.status === "running");
  const done = jobs.filter((j) => j.status === "done");
  const failed = jobs.filter((j) => j.status === "error");
  const allSettled = active.length === 0;
  // Overall = mean of per-job progress (done counts as 1).
  const overall =
    jobs.reduce((s, j) => s + (j.status === "done" ? 1 : j.status === "error" ? 0 : j.pct), 0) / jobs.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="panel flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden shadow-2xl">
        <div className="flex shrink-0 items-center gap-3 border-b border-border p-4">
          {!allSettled ? <Spinner className="size-5" /> : (
            <span className={`flex size-5 items-center justify-center rounded-full text-xs font-bold ${failed.length ? "bg-danger/20 text-danger" : "bg-ok/20 text-ok"}`}>
              {failed.length ? "!" : "✓"}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">
              {allSettled ? (failed.length ? "Export finished with errors" : "Export finished") : "Exporting clips"}
            </span>
            <span className="block font-mono text-[11px] text-muted">
              {done.length} done{failed.length > 0 ? ` · ${failed.length} failed` : ""} · {jobs.length} total
            </span>
          </div>
          {allSettled ? (
            <button className="btn" onClick={onClose}>
              close
            </button>
          ) : (
            onMinimize && (
              <button className="btn" onClick={onMinimize}>
                minimize
              </button>
            )
          )}
        </div>

        <div className="shrink-0 border-b border-border px-4 py-3">
          <div className="h-2 w-full overflow-hidden rounded bg-track">
            <div
              className={`h-full rounded transition-[width] duration-300 ${allSettled ? (failed.length ? "bg-danger" : "bg-ok") : "bg-accent"}`}
              style={{ width: `${Math.round(overall * 100)}%` }}
            />
          </div>
          <span className="mt-1 block text-right font-mono text-[11px] text-muted">
            {Math.round(overall * 100)}%
          </span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-4">
          {jobs.map((j) => (
            <JobRow key={j.id} job={j} />
          ))}
        </div>

        {allSettled && done.length > 0 && onClear && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border p-3">
            <button className="btn btn-sm" onClick={onClear}>
              clear finished
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
