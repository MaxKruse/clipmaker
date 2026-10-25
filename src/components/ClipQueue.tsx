"use client";

import { formatShort } from "@/lib/times";
import type { ClipSpec } from "@/lib/types";

interface Props {
  clips: ClipSpec[];
  selectedId: string | null;
  exporting: boolean;
  exportError: string | null;
  onAdd: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onExport: () => void;
}

export function ClipQueue({
  clips, selectedId, exporting, exportError, onAdd, onSelect, onDelete, onExport,
}: Props) {
  return (
    <div data-clips-panel className="panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="label">Clips ({clips.length})</span>
        <button className="btn btn-sm" onClick={onAdd}>
          Add clip
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {clips.length === 0 && (
          <span className="text-xs text-muted">
            Scrub the player, press I / O to mark a range, then "Add clip".
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
      {exportError && <span className="mt-2 block text-xs break-words text-danger">{exportError}</span>}
      <button
        className="btn btn-primary mt-3 w-full"
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
