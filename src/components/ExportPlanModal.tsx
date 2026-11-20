"use client";

import { useEffect, useRef, useState } from "react";
import { groupCombine } from "@/lib/combine";
import { formatTime } from "@/lib/times";
import type { ClipSpec } from "@/lib/types";

interface Props {
  clips: ClipSpec[];
  onClose: () => void;
  /** Start the export with the selected clips (list order = part order). */
  onStart: (clips: ClipSpec[], combine: boolean) => void;
}

/**
 * The export plan modal: "Export clips" opens this instead of
 * auto-starting the export. Every clip is a checked row (all preselected);
 * the "combine" toggle makes each same-name group ONE job - a single mp4
 * "highlights" file, parts concatenated with 0.5s fades, mp4 only.
 * Follows the VideoModal/ExportModal dialog conventions: capture-phase
 * Esc and a backdrop click close it, focus lands on the close button.
 */
export function ExportPlanModal({ clips, onClose, onStart }: Props) {
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
      className="fixed inset-0 z-50 flex bg-black/70 p-3 pt-8"
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
        className="panel flex h-full w-full flex-col p-3 shadow-2xl"
      >
        <div className="mb-2 flex shrink-0 items-center justify-between">
          <h2 className="text-sm font-medium">
            Export {clips.length} clip{clips.length === 1 ? "" : "s"}
          </h2>
          <button ref={closeRef} className="btn btn-sm" onClick={onClose}>
            close
          </button>
        </div>
        <div className="mb-2 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            select all
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={combine}
              onChange={(e) => setCombine(e.target.checked)}
            />
            combine same-name clips
          </label>
          <span className="text-muted">
            each part fades in and out over 0.5s; combined clips export as one mp4 (no gif/avif)
          </span>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          {clips.map((c, i) => (
            <label
              key={c.id}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-panel2 px-2 py-1 hover:border-accent/40"
            >
              <input
                type="checkbox"
                className="shrink-0"
                checked={selected.has(c.id)}
                onChange={() => toggleOne(c.id)}
              />
              <span className="shrink-0 font-mono text-xs text-muted">{i + 1}.</span>
              <span className="min-w-0 flex-1 truncate text-sm">{c.note || "unnamed"}</span>
              <span className="shrink-0 font-mono text-[11px] text-muted">
                {formatTime(c.start)} - {formatTime(c.end)}
              </span>
              {c.crop && <span className="chip shrink-0">crop</span>}
              {c.formats.map((f) => (
                <span key={f} className="chip shrink-0">
                  {f}
                </span>
              ))}
            </label>
          ))}
        </div>
        <div className="mt-3 flex shrink-0 items-center justify-between">
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
