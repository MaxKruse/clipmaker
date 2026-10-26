"use client";

import { formatShort } from "@/lib/times";
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
}

export function ClipQueue({
  clips, selectedId, exporting, exportError, attnAdd, onAdd, onSelect, onDelete, onExport,
}: Props) {
  return (
    <div data-clips-panel className="panel flex min-h-0 flex-1 flex-col p-3">
      <div className="mb-2 flex shrink-0 items-center justify-between">
        <span className="label">Clips ({clips.length})</span>
        <button className={`btn btn-sm ${attnAdd ? "attn" : ""}`} disabled={exporting} onClick={onAdd}>
          Add clip
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
        {clips.length === 0 && (
          <span className="text-xs text-muted">
            Click "Add clip", then set the times on the timeline and crop the video if you want. Selecting a clip edits it in place.
          </span>
        )}
        {clips.map((c, i) => (
          <div
            key={c.id}
            className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 ${
              c.id === selectedId
                ? "border-accent/60 bg-accent/10"
                : "border-border bg-panel2 hover:border-accent/40"
            }`}
            onClick={() => onSelect(c.id)}
          >
            <span className="font-mono text-xs text-muted">{i + 1}.</span>
            <span className="min-w-0 flex-1 truncate text-sm">{c.note || "unnamed"}</span>
            <span className="font-mono text-[11px] text-muted">
              {formatShort(c.start)} - {formatShort(c.end)}
            </span>
            {c.crop && <span className="chip">crop</span>}
            {c.formats.map((f) => (
              <span key={f} className="chip">
                {f}
              </span>
            ))}
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
        ))}
      </div>
      {exportError && <span className="mt-2 block shrink-0 text-xs break-words text-danger">{exportError}</span>}
      <button
        className="btn btn-primary mt-3 w-full shrink-0"
        disabled={clips.length === 0 || exporting}
        onClick={onExport}
      >
        {exporting
          ? "Queuing..."
          : clips.length === 0
            ? "Export"
            : `Export ${clips.length} clip${clips.length === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}
