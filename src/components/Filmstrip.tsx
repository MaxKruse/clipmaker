"use client";

import { useEffect, useState } from "react";
import { formatShort } from "@/lib/times";

interface Frame {
  time: number;
  src: string;
}
interface Status {
  ready: boolean;
  total: number;
  done: number;
  frames: Frame[];
}

interface Props {
  videoId: string;
  /** Seek the player to a frame's time (called on thumbnail click). */
  onSeek: (t: number) => void;
}

/**
 * Thumbnail filmstrip for finding moments in a long video. Frames are
 * generated server-side on first open (fast-seek one frame per planned
 * time, cached to disk) and polled until ready, so a 60-min video does
 * not stall the page on load. Clicking a thumbnail seeks the player.
 */
export function Filmstrip({ videoId, onSeek }: Props) {
  const [st, setSt] = useState<Status | null>(null);

  useEffect(() => {
    const id = videoId;
    let alive = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const res = await fetch(`/api/videos/${id}/filmstrip`);
        if (!res.ok) return;
        const j: Status = await res.json();
        if (!alive) return;
        setSt(j);
        if (!j.ready) timer = window.setTimeout(poll, 500);
      } catch {
        // server restarting - stop polling, it recovers on the next open
      }
    };
    setSt(null);
    void poll();
    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [videoId]);

  const pct = st && st.total > 0 ? Math.round((st.done / st.total) * 100) : 0;

  return (
    <div className="panel flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <span className="label">filmstrip</span>
        <span className="truncate font-mono text-[11px] text-muted">
          {st === null
            ? "loading..."
            : st.ready
              ? `${st.frames.length} frames - click one to jump there`
              : `generating ${st.done}/${st.total}...`}
        </span>
      </div>
      {st && !st.ready && (
        <div className="flex min-h-0 flex-1 items-center gap-3 rounded bg-track px-3">
          <div className="h-2 flex-1 overflow-hidden rounded bg-bg/40">
            <div className="h-full rounded bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </div>
          <span className="font-mono text-[11px] text-muted">{pct}%</span>
        </div>
      )}
      {st && st.ready && (
        /* Thumbnails scale with the strip height (the row is user-
           resizable); the width keeps the frame's own ratio. */
        <div className="scrollbar-thin flex min-h-0 flex-1 gap-1.5 overflow-x-auto pb-1">
          {st.frames.map((f) => (
            <button
              key={f.time}
              onClick={() => onSeek(f.time)}
              title={`jump to ${formatShort(f.time)}`}
              className="group relative shrink-0 rounded-md border border-border transition-colors hover:border-accent/60"
            >
              <img src={f.src} alt={formatShort(f.time)} loading="lazy" className="h-full w-auto min-w-20 max-w-48 rounded-md object-cover" />
              <span className="absolute bottom-0.5 right-1 rounded bg-black/60 px-1 font-mono text-[9px] text-white/90">
                {formatShort(f.time)}
              </span>
            </button>
          ))}
        </div>
      )}
      {st === null && <div className="min-h-0 flex-1 animate-pulse rounded bg-track" />}
    </div>
  );
}
