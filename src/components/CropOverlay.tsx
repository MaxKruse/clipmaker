"use client";

import { useRef } from "react";
import { MIN_CROP, normalizeCrop, type CropBox } from "@/lib/crop";

export type Aspect = "free" | "16:9" | "1:1" | "source";

const ratioOf = (a: Aspect, srcW: number, srcH: number): number => {
  if (a === "free") return 0;
  if (a === "16:9") return 16 / 9;
  if (a === "1:1") return 1;
  return srcW / srcH;
};

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type DragKind = Handle | "move" | "draw";

const HANDLES: { id: Handle; x: string; y: string; cursor: string }[] = [
  { id: "nw", x: "0%", y: "0%", cursor: "nwse-resize" },
  { id: "n", x: "50%", y: "0%", cursor: "ns-resize" },
  { id: "ne", x: "100%", y: "0%", cursor: "nesw-resize" },
  { id: "e", x: "100%", y: "50%", cursor: "ew-resize" },
  { id: "se", x: "100%", y: "100%", cursor: "nwse-resize" },
  { id: "s", x: "50%", y: "100%", cursor: "ns-resize" },
  { id: "sw", x: "0%", y: "100%", cursor: "nesw-resize" },
  { id: "w", x: "0%", y: "50%", cursor: "ew-resize" },
];

interface Props {
  /** The video frame rect inside the stage container, in container px. */
  frame: { x: number; y: number; w: number; h: number };
  srcW: number;
  srcH: number;
  crop: CropBox | null;
  aspect: Aspect;
  onChange: (c: CropBox | null) => void;
}

/**
 * Crop editor drawn over the video frame. The crop is stored in source
 * pixels (what ffmpeg receives); all geometry here converts to/from px.
 */
export function CropOverlay({ frame, srcW, srcH, crop, aspect, onChange }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ kind: DragKind; sx: number; sy: number; prev: CropBox | null } | null>(null);

  const s = frame.w / srcW; // container px per source px

  const toSrc = (e: React.PointerEvent) => {
    const r = rootRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - frame.x) / s, y: (e.clientY - r.top - frame.y) / s };
  };

  const inside = (p: { x: number; y: number }, c: CropBox | null) =>
    Boolean(c) && p.x >= c!.x && p.x <= c!.x + c!.w && p.y >= c!.y && p.y <= c!.y + c!.h;

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const h = (e.target as HTMLElement).dataset?.handle as Handle | undefined;
    const p = toSrc(e);
    let kind: DragKind;
    if (h) kind = h;
    else if (crop && inside(p, crop)) kind = "move";
    else kind = "draw"; // no crop, or click outside it: start a fresh draw
    drag.current = { kind, sx: p.x, sy: p.y, prev: crop };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toSrc(e);
    const dx = p.x - d.sx;
    const dy = p.y - d.sy;
    const r = ratioOf(aspect, srcW, srcH);
    const o = d.prev!;
    let box: CropBox;

    if (d.kind === "draw") {
      let w = Math.abs(p.x - d.sx);
      let h = Math.abs(p.y - d.sy);
      if (r) {
        if (w / Math.max(h, 0.001) > r) w = h * r;
        else h = w / r;
      }
      box = { x: p.x >= d.sx ? d.sx : d.sx - w, y: p.y >= d.sy ? d.sy : d.sy - h, w, h };
    } else if (d.kind === "move") {
      box = { x: o.x + dx, y: o.y + dy, w: o.w, h: o.h };
    } else {
      let { x, y, w, h } = o;
      if (d.kind === "w" || d.kind === "nw" || d.kind === "sw") {
        w = o.w - dx;
        x = o.x + dx;
      }
      if (d.kind === "e" || d.kind === "ne" || d.kind === "se") w = o.w + dx;
      if (d.kind === "n" || d.kind === "nw" || d.kind === "ne") {
        h = o.h - dy;
        y = o.y + dy;
      }
      if (d.kind === "s" || d.kind === "sw" || d.kind === "se") h = o.h + dy;
      if (r > 0) {
        // Re-anchor to the opposite corner/edge so the ratio holds.
        if (w < 0) w = 0;
        if (h < 0) h = 0;
        if (w / Math.max(h, 0.001) > r) w = h * r;
        else h = w / r;
        if (d.kind === "nw") { x = o.x + o.w - w; y = o.y + o.h - h; }
        if (d.kind === "ne") { x = o.x; y = o.y + o.h - h; }
        if (d.kind === "sw") { x = o.x + o.w - w; y = o.y; }
        if (d.kind === "se") { x = o.x; y = o.y; }
        if (d.kind === "n" || d.kind === "s") { w = h * r; x = o.x + (o.w - w) / 2; }
        if (d.kind === "e" || d.kind === "w") { h = w / r; y = o.y + (o.h - h) / 2; }
      }
      box = { x, y, w, h };
    }
    box.w = Math.max(MIN_CROP, box.w);
    box.h = Math.max(MIN_CROP, box.h);
    onChange(normalizeCrop(srcW, srcH, box));
  };

  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.kind !== "draw") return;
    // A tiny draw is a click: keep the old crop, or plant a minimum box.
    const p = toSrc(e);
    if (Math.abs(p.x - d.sx) < 3 && Math.abs(p.y - d.sy) < 3) {
      if (d.prev) onChange(d.prev);
      else onChange(normalizeCrop(srcW, srcH, { x: d.sx, y: d.sy, w: MIN_CROP, h: MIN_CROP }));
    }
  };

  const cs = (v: number) => `${v * s}px`;

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 z-10 cursor-crosshair touch-none select-none"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
    >
      {crop && (
        <div
          className="absolute"
          style={{
            left: cs(crop.x),
            top: cs(crop.y),
            width: cs(crop.w),
            height: cs(crop.h),
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
            outline: "1px solid var(--color-accent)",
            cursor: "move",
          }}
        >
          {HANDLES.map((h) => (
            <div
              key={h.id}
              data-handle={h.id}
              className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-black/40 bg-accent"
              style={{ left: h.x, top: h.y, cursor: h.cursor }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
