"use client";

import { useRef } from "react";
import { formatShort } from "@/lib/times";

interface Props {
  duration: number;
  time: number;
  /** Range bounds; null = no range set (free playback). */
  inPoint: number | null;
  outPoint: number | null;
  onScrub: (t: number) => void;
  onIn: (t: number) => void;
  onOut: (t: number) => void;
  onMoveSel: (a: number, b: number) => void;
  /** Drag on the empty track: live range while drawing. */
  onDraw: (a: number, b: number) => void;
  /** Right-click on the range: clear it. */
  onClearRange: () => void;
}

type DragKind = "maybe" | "draw" | "in" | "out" | "move";

/** Scrub bar: click seeks, drag on the empty track draws the in/out
 * range, drag on the range moves it, edge handles resize it, and a
 * right-click on the range clears it. */
export function Timeline({ duration, time, inPoint, outPoint, onScrub, onIn, onOut, onMoveSel, onDraw, onClearRange }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ kind: DragKind; startT: number; startX: number; origIn: number; origOut: number } | null>(null);

  const tAt = (clientX: number) => {
    const r = rootRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration));
  };

  const onDown = (e: React.PointerEvent) => {
    const el = e.target as HTMLElement;
    const kind = (el.dataset.tl as DragKind | undefined) ?? "maybe";
    const t = tAt(e.clientX);
    drag.current = {
      kind,
      startT: t,
      startX: e.clientX,
      origIn: inPoint ?? 0,
      origOut: outPoint ?? 0,
    };
    el.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const t = tAt(e.clientX);
    const min = 0.2;
    if (d.kind === "maybe") {
      // A single press seeks (handled in onUp); real movement draws.
      if (Math.abs(e.clientX - d.startX) < 4) return;
      d.kind = "draw";
    }
    if (d.kind === "draw") {
      onDraw(Math.min(d.startT, t), Math.max(d.startT, t));
      onScrub(t);
    } else if (d.kind === "in") onIn(Math.min(t, d.origOut - min));
    else if (d.kind === "out") onOut(Math.max(t, d.origIn + min));
    else if (d.kind === "move") {
      const len = d.origOut - d.origIn;
      const a = Math.max(0, Math.min(d.origIn + (t - d.startT), duration - len));
      onMoveSel(a, a + len);
    }
  };

  const onUp = () => {
    const d = drag.current;
    if (d?.kind === "maybe") onScrub(d.startT);
    drag.current = null;
  };

  const pct = (t: number) => `${(t / Math.max(duration, 0.001)) * 100}%`;

  return (
    <div
      data-player
      ref={rootRef}
      className="relative h-12 cursor-crosshair touch-none select-none overflow-hidden rounded-md bg-track"
      onPointerDown={onDown}
      onPointerMove={onPointerMove}
      onPointerUp={onUp}
    >
      {inPoint != null && outPoint != null && (
        <>
          <div
            data-tl="move"
            title="drag: move range - right-click: clear"
            onContextMenu={(e) => {
              e.preventDefault();
              onClearRange();
            }}
            className="absolute top-0 flex h-full cursor-grab items-center justify-center bg-accent/15 hover:bg-accent/20"
            style={{
              left: pct(inPoint),
              width: `calc(${pct(outPoint)} - ${pct(inPoint)})`,
              borderLeft: "2px solid var(--color-accent)",
              borderRight: "2px solid var(--color-accent)",
            }}
          >
            <span className="pointer-events-none font-mono text-[10px] whitespace-nowrap text-muted">
              {formatShort(inPoint)} - {formatShort(outPoint)}
            </span>
          </div>
          <div data-tl="in" className="absolute top-0 h-full w-3 cursor-ew-resize bg-accent/80" style={{ left: `calc(${pct(inPoint)} - 6px)` }} />
          <div data-tl="out" className="absolute top-0 h-full w-3 cursor-ew-resize bg-accent/80" style={{ left: `calc(${pct(outPoint)} - 6px)` }} />
        </>
      )}
      <div className="pointer-events-none absolute top-0 h-full w-px bg-white/60" style={{ left: pct(time) }} />
    </div>
  );
}
