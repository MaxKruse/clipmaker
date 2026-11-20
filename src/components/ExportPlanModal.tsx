"use client";

import { useEffect, useRef, useState } from "react";
import { comboDuration, groupCombine } from "@/lib/combine";
import { formatClipTime, formatTime } from "@/lib/times";
import type { ClipSpec } from "@/lib/types";

interface Props {
  clips: ClipSpec[];
  /** Source fps - the preview uses it to compute combined durations. */
  videoFps: number;
  onClose: () => void;
  /** Start the export with the selected clips (list order = part order). */
  onStart: (clips: ClipSpec[], combine: boolean) => void;
}

/**
 * A rounded, accent-filled checkbox drawn with CSS (the real input stays
 * sr-only); `peer` keeps focus/checked state on the visual square.
 */
function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid size-5 shrink-0 place-items-center rounded-md border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50 ${
        checked
          ? "border-accent bg-accent text-bg"
          : "border-border bg-bg text-transparent"
      }`}
    >
      <svg
        viewBox="0 0 12 12"
        className="size-3"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2 6.5 4.5 9 10 3.5" />
      </svg>
    </span>
  );
}

/**
 * The export plan modal: "Export clips" opens this instead of
 * auto-starting the export. A compact card list with one checkbox per
 * clip (all preselected); the "combine" toggle switches on a preview of
 * the highlights files the export WOULD create - one card per same-name
 * group, dimmed while any of its clips is unticked. Combined files are
 * MP4 only, each part with 0.5s fades.
 * Follows the VideoModal/ExportModal dialog conventions: capture-phase
 * Esc and a backdrop click close it, focus lands on the close button.
 */
export function ExportPlanModal({ clips, videoFps, onClose, onStart }: Props) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(clips.map((c) => c.id)),
  );
  const [combine, setCombine] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Focus the close button on open; restore the previous holder on close.
  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      if (prev && prev.isConnected) prev.focus();
    };
  }, []);

  const selectedClips = clips.filter((c) => selected.has(c.id));
  const allSelected = selectedClips.length === clips.length;
  const jobCount = combine ? groupCombine(selectedClips).length : selectedClips.length;
  // Multi-clip same-name groups: what a combined export would build.
  const highlightGroups = groupCombine(clips).filter((g) => g.length > 1);

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(clips.map((c) => c.id)));
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 px-4 pt-[9vh]"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Export clips"
        className="panel flex max-h-[82vh] w-full max-w-xl flex-col overflow-hidden shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium">
            Export {clips.length} clip{clips.length === 1 ? "" : "s"}
          </h2>
          <button ref={closeRef} className="btn btn-sm" onClick={onClose}>
            close
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 scrollbar-thin">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={allSelected}
                onChange={toggleAll}
              />
              <CheckBox checked={allSelected} />
              select all
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={combine}
                onChange={(e) => setCombine(e.target.checked)}
              />
              <CheckBox checked={combine} />
              combine same-name clips
            </label>
          </div>

          <div className="space-y-1.5">
            {clips.map((c, i) => {
              const on = selected.has(c.id);
              return (
                <label
                  key={c.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border bg-panel2 px-3 py-2 transition-colors ${
                    on
                      ? "border-border hover:border-accent/50"
                      : "border-border opacity-50 hover:opacity-80"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={on}
                    onChange={() => toggleOne(c.id)}
                  />
                  <CheckBox checked={on} />
                  <span className="w-4 shrink-0 text-right font-mono text-xs text-muted">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {c.note || "unnamed"}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted">
                    {formatTime(c.start)} - {formatTime(c.end)}
                  </span>
                  {c.crop && <span className="chip shrink-0">crop</span>}
                  {c.formats.map((f) => (
                    <span key={f} className="chip shrink-0">
                      {f}
                    </span>
                  ))}
                </label>
              );
            })}
          </div>

          {combine && (
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="label">combined highlights</span>
                <span className="text-[11px] text-muted">
                  one mp4 per group · 0.5s fade per part
                </span>
              </div>
              {highlightGroups.length === 0 ? (
                <p className="text-xs text-muted">
                  no two clips share a note - nothing to combine
                </p>
              ) : (
                highlightGroups.map((g) => {
                  const parts = g.filter((c) => selected.has(c.id)).length;
                  const on = parts === g.length;
                  return (
                    <div
                      key={g[0].note}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition-opacity ${
                        on
                          ? "border-accent/40 bg-panel2"
                          : "border-border bg-panel opacity-50"
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`grid size-5 shrink-0 place-items-center rounded-md ${
                          on ? "bg-accent/15 text-accent" : "bg-panel2 text-muted"
                        }`}
                      >
                        <svg viewBox="0 0 12 12" className="size-3" fill="currentColor">
                          <path d="M3 2l7 4-7 4z" />
                        </svg>
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {g[0].note}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-muted">
                        {on
                          ? `${g.length} part${g.length === 1 ? "" : "s"}`
                          : `${parts} of ${g.length} part${g.length === 1 ? "" : "s"}`}{" "}
                        · {formatClipTime(comboDuration(g, videoFps))}s
                      </span>
                      <span className="chip shrink-0">mp4</span>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-border px-4 py-3">
          <span className="text-xs text-muted">
            {selectedClips.length} clip{selectedClips.length === 1 ? "" : "s"} - {jobCount} export
            {jobCount === 1 ? "" : "s"}
          </span>
          <button
            className="btn btn-primary"
            disabled={selectedClips.length === 0}
            onClick={() => onStart(selectedClips, combine)}
          >
            Start export
          </button>
        </div>
      </div>
    </div>
  );
}
