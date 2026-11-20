"use client";

import { useRef, useState } from "react";
import { Dialog } from "@/components/Dialog";
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
 * auto-starting the export. Two panes: the clip cards (one checkbox each,
 * all preselected, unticked cards dimmed) on the left, and the "combined
 * highlights" preview on the right - always visible, one card per
 * same-name group with part count and total duration, dimmed while the
 * combine toggle is off OR any of the group's clips is unticked.
 * Combined files are MP4 only, each part with 0.5s fades.
 */
export function ExportPlanModal({ clips, videoFps, onClose, onStart }: Props) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(clips.map((c) => c.id)),
  );
  const [combine, setCombine] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);

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
    <Dialog
      label="Export clips"
      onClose={onClose}
      overlay="items-start justify-center px-4 pt-[9vh]"
      panel="flex max-h-[82vh] w-full max-w-4xl flex-col overflow-hidden"
      focusRef={closeRef}
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

        <div className="grid grid-cols-2 gap-4">
          <div className="min-w-0 space-y-2">
            <span className="label">clips</span>
            <div className="space-y-1.5">
              {clips.map((c, i) => {
                const on = selected.has(c.id);
                return (
                  <label
                    key={c.id}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-lg border bg-panel2 px-3 py-2 transition-colors ${
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
                    {/* time + chips share one wrappable group so long
                        timestamps and all three formats never overflow
                        the card - chips drop to a second line */}
                    <span className="flex min-w-0 items-center justify-end gap-x-1.5 gap-y-1 wrap">
                      <span className="shrink-0 font-mono text-xs text-muted">
                        {formatTime(c.start)} - {formatTime(c.end)}
                      </span>
                      {c.crop && <span className="chip shrink-0">crop</span>}
                      {c.formats.map((f) => (
                        <span key={f} className="chip shrink-0">
                          {f}
                        </span>
                      ))}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="min-w-0 space-y-2">
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
                const on = combine && parts === g.length;
                return (
                  <div
                    key={g[0].note}
                    className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 transition-opacity ${
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
                    <span className="min-w-0 shrink overflow-hidden font-mono text-xs text-muted [text-overflow:ellipsis] whitespace-nowrap">
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
        </div>
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
    </Dialog>
  );
}
