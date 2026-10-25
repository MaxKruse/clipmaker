"use client";

import { useRef } from "react";
import { formatShort } from "@/lib/times";

interface Props {
  duration: number;
  time: number;
  inPoint: number;
  outPoint: number;
  onScrub: (t: number) => void;
  onIn: (t: number) => void;
  onOut: (t: number) => void;
  onMoveSel: (a: number, b: number) => void;
}

type DragKind = "scrub" | "in" | "out" | "move";

/** Scrub bar with in/out handles and a draggable selection. */
export function Timeline({ duration, time, inPoint, outPoint, onScrub, onIn, onOut, onMoveSel }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ kind: DragKind; startT: number; origIn: number; origOut: number } | null>(null);

  const tAt = (clientX: number) => {
    const r = rootRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration));
  };

  const onDown = (e: React.PointerEvent) => {
    const el = e.target as HTMLElement;
    const kind = (el.dataset.tl as DragKind | undefined) ?? "scrub";
    const t = tAt(e.clientX);
    drag.current = { kind, startT: t, origIn: inPoint, origOut: outPoint };
    if (kind === "scrub") onScrub(t);
    el.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const t = tAt(e.clientX);
    const min = 0.2;
    if (d.kind === "scrub") onScrub(t);
    else if (d.kind === "in") onIn(Math.min(t, outPoint - min));
    else if (d.kind === "out") onOut(Math.max(t, inPoint + min));
    else if (d.kind === "move") {
      const len = d.origOut - d.origIn;
      const a = Math.max(0, Math.min(d.origIn + (t - d.startT), duration - len));
      onMoveSel(a, a + len);
    }
  };

  const onUp = () => {
    drag.current = null;
  };

  const pct = (t: number) => `${(t / Math.max(duration, 0.001)) * 100}%`;

  return (
    <div
      data-player
      ref={rootRef}
      className="relative h-12 touch-none select-none overflow-hidden rounded-md bg-track"
      onPointerDown={onDown}
      onPointerMove={onPointerMove}
      onPointerUp={onUp}
    >
      <div
        data-tl="move"
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
      <div className="pointer-events-none absolute top-0 h-full w-px bg-white/60" style={{ left: pct(time) }} />
    </div>
  );
}
