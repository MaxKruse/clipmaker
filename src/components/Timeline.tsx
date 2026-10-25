"use client";

import { useEffect, useRef, useState } from "react";
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

type DragKind = "maybe" | "pan" | "draw" | "in" | "out" | "move";

/** px from the track edge that triggers auto-panning while dragging. */
const PAN_MARGIN = 28;
/** Max zoomed-in window, in seconds. */
const MIN_SPAN = 60;

/** Scrub bar: click seeks, drag on the empty track draws the in/out
 * range, drag on the range moves it, edge handles resize it, a
 * right-click clears the range, the wheel zooms (60s at max zoom,
 * the whole video at max zoom-out), shift+wheel and shift+drag scroll
 * the view, and a double-click fits the whole video. While dragging a
 * range near the track edge, the view auto-scrolls so the content can
 * be carried across the whole video. */
export function Timeline({ duration, time, inPoint, outPoint, onScrub, onIn, onOut, onMoveSel, onDraw, onClearRange }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ kind: DragKind; startT: number; startX: number; origIn: number; origOut: number; viewStart: number; viewSpan: number } | null>(null);
  const panPos = useRef(0);
  const panRaf = useRef<number | null>(null);
  // Visible time window; the whole video by default.
  const [view, setView] = useState({ start: 0, end: Math.max(duration, 0.001) });
  const span = view.end - view.start;
  const zoomed = duration > 0 && span < duration - 0.001;
  const viewRef = useRef(view);
  viewRef.current = view;

  // Reset the view when switching videos.
  useEffect(() => {
    setView({ start: 0, end: duration });
  }, [duration]);

  // Native wheel listener - React's onWheel is passive and cannot
  // preventDefault, which would let the page scroll while zooming.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.shiftKey) {
        // Shift+wheel scrolls the visible window horizontally.
        const d = ((e.deltaY + e.deltaX) / r.width) * span;
        const start = Math.max(0, Math.min(view.start + d, duration - span));
        if (start !== view.start) setView({ start, end: start + span });
        return;
      }
      const anchor = view.start + ((e.clientX - r.left) / r.width) * span;
      const newSpan = Math.min(duration, Math.max(Math.min(MIN_SPAN, duration), span * Math.exp(e.deltaY * 0.001)));
      if (newSpan === span) return;
      const f = Math.max(0, Math.min(1, (anchor - view.start) / span));
      const start = Math.max(0, Math.min(anchor - f * newSpan, duration - newSpan));
      setView({ start, end: start + newSpan });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [view, span, duration]);

  const tAt = (clientX: number) => {
    const r = rootRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(duration, view.start + ((clientX - r.left) / r.width) * span));
  };

  // Edge auto-pan while dragging a range: while the pointer stays near
  // a track edge the view scrolls, and the dragged content follows the
  // pointer (its time references shift with the view, and the live
  // callbacks re-fire so the draft stays in sync).
  const startAutoPan = () => {
    if (panRaf.current !== null) return;
    let last = performance.now();
    const tick = (now: number) => {
      const d = drag.current;
      const el = rootRef.current;
      if (!d || !el || (d.kind !== "draw" && d.kind !== "move")) {
        panRaf.current = null;
        return;
      }
      const r = el.getBoundingClientRect();
      const x = panPos.current;
      const dir = x < r.left + PAN_MARGIN ? -1 : x > r.right - PAN_MARGIN ? 1 : 0;
      if (dir === 0) {
        panRaf.current = null;
        return;
      }
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const v = viewRef.current;
      const s = v.end - v.start;
      const start = Math.max(0, Math.min(v.start + dir * s * 0.5 * dt, duration - s));
      const moved = start - v.start;
      if (moved !== 0) {
        d.startT += moved;
        d.origIn += moved;
        d.origOut += moved;
        const tNow = Math.max(0, Math.min(duration, start + ((x - r.left) / r.width) * s));
        if (d.kind === "move") {
          const len = d.origOut - d.origIn;
          const a = Math.max(0, Math.min(d.origIn + (tNow - d.startT), duration - len));
          onMoveSel(a, a + len);
        } else {
          onDraw(Math.min(d.startT, tNow), Math.max(d.startT, tNow));
        }
        setView({ start, end: start + s });
      }
      panRaf.current = requestAnimationFrame(tick);
    };
    panRaf.current = requestAnimationFrame(tick);
  };

  const stopAutoPan = () => {
    if (panRaf.current !== null) {
      cancelAnimationFrame(panRaf.current);
      panRaf.current = null;
    }
  };

  useEffect(() => stopAutoPan, []);

  const onDown = (e: React.PointerEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest("button")) return;
    const kind = (el.dataset.tl as DragKind | undefined) ?? (e.shiftKey ? "pan" : "maybe");
    const t = tAt(e.clientX);
    drag.current = {
      kind,
      startT: t,
      startX: e.clientX,
      origIn: inPoint ?? 0,
      origOut: outPoint ?? 0,
      viewStart: view.start,
      viewSpan: span,
    };
    panPos.current = e.clientX;
    el.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    panPos.current = e.clientX;
    const t = tAt(e.clientX);
    const min = 0.2;
    if (d.kind === "maybe") {
      // A single press seeks (handled in onUp); real movement draws.
      if (Math.abs(e.clientX - d.startX) < 4) return;
      d.kind = "draw";
    }
    if (d.kind === "pan") {
      const r = rootRef.current!.getBoundingClientRect();
      const dt = ((e.clientX - d.startX) / r.width) * d.viewSpan;
      const start = Math.max(0, Math.min(d.viewStart - dt, duration - d.viewSpan));
      setView({ start, end: start + d.viewSpan });
    } else if (d.kind === "draw") {
      startAutoPan();
      onDraw(Math.min(d.startT, t), Math.max(d.startT, t));
      onScrub(t);
    } else if (d.kind === "in") onIn(Math.min(t, d.origOut - min));
    else if (d.kind === "out") onOut(Math.max(t, d.origIn + min));
    else if (d.kind === "move") {
      startAutoPan();
      const len = d.origOut - d.origIn;
      const a = Math.max(0, Math.min(d.origIn + (t - d.startT), duration - len));
      onMoveSel(a, a + len);
    }
  };

  const onUp = () => {
    stopAutoPan();
    const d = drag.current;
    if (d?.kind === "maybe") onScrub(d.startT);
    drag.current = null;
  };

  const pct = (t: number) => `${(((t - view.start) / Math.max(span, 0.001)) * 100)}%`;

  return (
    <div
      data-player
      ref={rootRef}
      title="wheel: zoom - shift+wheel: scroll - shift+drag: pan - double-click: fit"
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest("button, [data-tl]")) return;
        setView({ start: 0, end: duration });
      }}
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
      {zoomed && (
        <div className="pointer-events-none absolute right-1 top-1 flex items-center gap-1.5">
          <span className="chip font-mono text-[10px] whitespace-nowrap text-muted">
            {formatShort(view.start)} - {formatShort(view.end)}
          </span>
          <button className="btn btn-sm pointer-events-auto" onClick={() => setView({ start: 0, end: duration })}>
            fit
          </button>
        </div>
      )}
      <div className="pointer-events-none absolute top-0 h-full w-px bg-white/60" style={{ left: pct(time) }} />
    </div>
  );
}
