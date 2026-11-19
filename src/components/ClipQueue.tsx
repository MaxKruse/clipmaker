"use client";

import { avifDurationLevel, avifWarningText } from "@/lib/avif";
import { formatTime } from "@/lib/times";
import type { ClipSpec } from "@/lib/types";

interface Props {
  clips: ClipSpec[];
  selectedId: string | null;
  exporting: boolean;
  exportError: string | null;
  /** Add clip glows while no clip is selected (it starts the flow). */
  attnAdd?: boolean;
  onAdd: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onExport: () => void;
  onExportTxt: () => void;
}

export function ClipQueue({
  clips, selectedId, exporting, exportError, attnAdd, onAdd, onSelect, onDelete, onExport, onExportTxt,
}: Props) {
  return (
    <div data-clips-panel className="panel flex flex-col p-3 xl:min-h-0 xl:flex-1">
      <div className="mb-2 flex shrink-0 items-center justify-between">
        <span className="label">Clips ({clips.length})</span>
        <button className={`btn btn-sm ${attnAdd ? "attn" : ""}`} disabled={exporting} onClick={onAdd}>
          Add clip
        </button>
      </div>
      {/* The list is height-capped (~12 rows) at every size: a long
       * queue scrolls internally instead of stretching the page, so
       * the next clip is always a short scroll away. */}
      <div className="flex max-h-[420px] flex-col gap-1 overflow-y-auto pr-1 xl:min-h-0 xl:flex-1">
        {clips.length === 0 && (
          <span className="text-xs text-muted">
            Click "Add clip", then set the times on the timeline and crop the video if you want. Selecting a clip edits it in place.
          </span>
        )}
        {clips.map((c, i) => {
          const avifLvl = c.formats.includes("avif") ? avifDurationLevel(c.end - c.start) : "none";
          return (
          <div
            key={c.id}
            className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1 ${
              c.id === selectedId
                ? "border-accent/60 bg-accent/10"
                : "border-border bg-panel2 hover:border-accent/40"
            }`}
            onClick={() => onSelect(c.id)}
          >
            <span className="font-mono text-xs text-muted">{i + 1}.</span>
            <span className="min-w-0 flex-1 truncate text-sm">{c.note || "unnamed"}</span>
            <span className="font-mono text-[11px] text-muted">
              {formatTime(c.start)} - {formatTime(c.end)}
            </span>
            {c.crop && <span className="chip">crop</span>}
            {c.formats.map((f) => (
              <span key={f} className="chip">
                {f}
              </span>
            ))}
            {avifLvl !== "none" && (
              <span
                className={avifLvl === "danger" ? "chip text-danger" : "chip text-warn"}
                title={avifWarningText(avifLvl, c.end - c.start)}
              >
                slow
              </span>
            )}
            <button
              className="btn btn-sm btn-danger"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(c.id);
              }}
            >
              x
            </button>
          </div>
          );
        })}
      </div>
      {exportError && <span className="mt-2 block shrink-0 text-xs break-words text-danger">{exportError}</span>}
      <div className="mt-3 flex shrink-0 gap-2">
        <button
          className="btn btn-primary min-w-0 flex-1"
          disabled={clips.length === 0 || exporting}
          onClick={onExport}
        >
          {exporting
            ? "Queuing..."
            : clips.length === 0
              ? "Export"
              : `Export ${clips.length} clip${clips.length === 1 ? "" : "s"}`}
        </button>
        <button
          className="btn btn-sm shrink-0 self-center"
          disabled={clips.length === 0}
          onClick={onExportTxt}
          title="Download a clips.txt with the current timestamps and notes"
        >
          clips.txt
        </button>
      </div>
    </div>
  );
}
