"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { CropBox } from "@/lib/crop";
import { formatShort, formatTime } from "@/lib/times";
import { CropOverlay, type Aspect } from "./CropOverlay";

interface StageProps {
  src: string;
  srcW: number;
  srcH: number;
  videoRef: RefObject<HTMLVideoElement | null>;
  time: number;
  playing: boolean;
  duration: number;
  fps: number;
  inPoint: number | null;
  outPoint: number | null;
  crop: CropBox | null;
  aspect: Aspect;
  onTogglePlay: (p: boolean) => void;
  onPlayingChange: (p: boolean) => void;
  onTime: (t: number) => void;
  onSeek: (t: number) => void;
  onIn: (t: number) => void;
  onOut: (t: number) => void;
  onCropChange: (c: CropBox | null) => void;
  /** Position to return to when leaving the clip preview, if any. */
  returnTo: number | null;
  /** Leave the clip preview and restore the previous position. */
  onBack: () => void;
}

/** The video player with transport row and the crop overlay. */
export function Stage(props: StageProps) {
  const {
    src, srcW, srcH, videoRef, time, playing, duration, fps, inPoint, outPoint,
    crop, aspect,
    onTogglePlay, onPlayingChange, onTime, onSeek, onIn, onOut, onCropChange,
    returnTo, onBack,
  } = props;
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [vol, setVol] = useState(1);
  const [muted, setMuted] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [scrubbing, setScrubbing] = useState(false);

  // Secondary scrubber under the video: click seeks, drag scrubs.
  const seekAt = (clientX: number) => {
    const r = barRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    onSeek(f * duration);
  };

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Volume/muted are video-element properties, not React attrs.
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.volume = vol;
  }, [vol, videoRef]);
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.muted = muted;
  }, [muted, videoRef]);

  // Space play/pause, I/O set in/out, arrows seek (shift = one frame).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") return;
      const v = videoRef.current;
      if (!v) return;
      const frame = 1 / fps;
      if (e.key === " ") {
        e.preventDefault();
        onTogglePlay(v.paused);
      } else if (e.key === "i" || e.key === "I") {
        onIn(v.currentTime);
      } else if (e.key === "o" || e.key === "O") {
        onOut(v.currentTime);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        onSeek(v.currentTime + dir * (e.shiftKey ? frame : 1));
      } else if (e.key === "Escape") {
        onBack();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fps, videoRef, onTogglePlay, onIn, onOut, onSeek, onBack]);

  // Letterbox: the video frame rect inside the 16:9 stage container.
  const scale = box.w > 0 && box.h > 0 ? Math.min(box.w / srcW, box.h / srcH) : 0;
  const frame = {
    x: (box.w - srcW * scale) / 2,
    y: (box.h - srcH * scale) / 2,
    w: srcW * scale,
    h: srcH * scale,
  };

  return (
    <div data-player className="panel p-2">
      <div
        ref={boxRef}
        className="relative w-full overflow-hidden rounded-md bg-black"
        style={{ aspectRatio: "16 / 9" }}
      >
        <video
          ref={videoRef}
          src={src}
          preload="metadata"
          playsInline
          onPlay={() => onPlayingChange(true)}
          onPause={() => onPlayingChange(false)}
          onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)}
          className="h-full w-full object-contain"
        />
        {scale > 0 && (
          <CropOverlay
            frame={frame}
            srcW={srcW}
            srcH={srcH}
            crop={crop}
            aspect={aspect}
            onChange={onCropChange}
          />
        )}
      </div>
      <div
        ref={barRef}
        title="click or drag to scrub"
        className="group relative my-2 h-2.5 cursor-pointer touch-none select-none rounded-full bg-track"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          setScrubbing(true);
          seekAt(e.clientX);
        }}
        onPointerMove={(e) => {
          if (scrubbing) seekAt(e.clientX);
        }}
        onPointerUp={() => setScrubbing(false)}
      >
        {inPoint != null && outPoint != null && outPoint > inPoint && (
          <div
            className="absolute top-0 h-full rounded-full bg-accent/30"
            style={{
              left: `${(inPoint / Math.max(duration, 0.001)) * 100}%`,
              width: `${((outPoint - inPoint) / Math.max(duration, 0.001)) * 100}%`,
            }}
          />
        )}
        <div
          className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-accent"
          style={{ left: `${(time / Math.max(duration, 0.001)) * 100}%` }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 px-1 pb-1">
        <button className="btn btn-sm" onClick={() => onTogglePlay(!playing)}>
          {playing ? "Pause" : "Play"}
        </button>
        <button className="btn btn-sm" onClick={() => onSeek(time - 1 / fps)}>-1f</button>
        <button className="btn btn-sm" onClick={() => onSeek(time + 1 / fps)}>+1f</button>
        <button className="btn btn-sm" onClick={() => onIn(time)}>In (I)</button>
        <button className="btn btn-sm" onClick={() => onOut(time)}>Out (O)</button>
        <div className="ml-auto flex items-center gap-2">
          <button className="btn btn-sm" onClick={() => setMuted(!muted)}>
            {muted ? "Unmute" : "Mute"}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(vol * 100)}
            onChange={(e) => {
              setVol(Number(e.target.value) / 100);
              setMuted(false);
            }}
            aria-label="Volume"
            className="w-24 accent-accent"
          />
          <span className="font-mono text-xs text-muted">
            {formatTime(time)} / {formatTime(duration)}
          </span>
          {returnTo !== null && (
            <button
              className="btn btn-sm"
              onClick={onBack}
              title="Back to the position before the clip preview (Esc)"
            >
              &#8598; {formatShort(returnTo)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
