"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  /** "col" = vertical seam between the two columns (dragged
   * horizontally); "row" = horizontal seam between stacked panels
   * (dragged vertically). */
  dir: "col" | "row";
  /** Called once when the drag starts. The page records the size the
   * drag moves from (a panel starts at its natural height, which is
   * only known by measuring it). */
  onStart?: () => void;
  /** Called on every move: total px dragged since the start of the
   * drag (positive = the drag went toward the second panel). */
  onResize: (total: number) => void;
  /** Called when the drag ends. The page persists the layout. */
  onEnd?: () => void;
  /** Called on double-click. The page resets that seam to its default. */
  onReset?: () => void;
}

/** A draggable seam between two layout regions: a short grip that turns
 * accent while dragging. Hidden below xl, where the work area is a
 * single column with no resizable regions. */
export function Resizer({ dir, onStart, onResize, onEnd, onReset }: Props) {
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);

  // A mid-drag unmount (video switch) must not leave the body locked.
  useEffect(
    () => () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    },
    [],
  );

  const end = () => {
    if (!start.current) return;
    start.current = null;
    setDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    onEnd?.();
  };

  return (
    <div
      data-layout
      role="separator"
      aria-orientation={dir === "col" ? "vertical" : "horizontal"}
      title="drag to resize - double-click to reset"
      className={`group hidden touch-none select-none items-center justify-center xl:flex ${
        dir === "col" ? "w-3 cursor-col-resize" : "h-3 cursor-row-resize"
      }`}
      // No preventDefault here: cancelling pointerdown would suppress
      // the compat mouse events (the double-click reset depends on them).
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, y: e.clientY };
        setDragging(true);
        // Follow the cursor past the handle: pointer capture keeps the
        // events, but the cursor and selection follow the hovered element.
        document.body.style.cursor = dir === "col" ? "col-resize" : "row-resize";
        document.body.style.userSelect = "none";
        onStart?.();
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        onResize(dir === "col" ? e.clientX - start.current.x : e.clientY - start.current.y);
      }}
      onPointerUp={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
        end();
      }}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={onReset}
    >
      <div
        className={`rounded-full transition-colors ${
          dragging ? "bg-accent" : "bg-border group-hover:bg-accent/70"
        } ${dir === "col" ? "h-8 w-[3px]" : "h-[3px] w-12"}`}
      />
    </div>
  );
}
