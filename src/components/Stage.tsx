"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { CropBox } from "@/lib/crop";
import { formatTime } from "@/lib/times";
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
  inPoint: number;
  outPoint: number;
  crop: CropBox | null;
  aspect: Aspect;
  onTogglePlay: (p: boolean) => void;
  onPlayingChange: (p: boolean) => void;
  onTime: (t: number) => void;
  onSeek: (t: number) => void;
  onIn: (t: number) => void;
  onOut: (t: number) => void;
  onCropChange: (c: CropBox | null) => void;
}

/** The video player with transport row and the crop overlay. */
export function Stage(props: StageProps) {
  const {
    src, srcW, srcH, videoRef, time, playing, duration, fps,
    crop, aspect,
    onTogglePlay, onPlayingChange, onTime, onSeek, onIn, onOut, onCropChange,
  } = props;
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [vol, setVol] = useState(1);
  const [muted, setMuted] = useState(false);

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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fps, videoRef, onTogglePlay, onIn, onOut, onSeek]);

  // Letterbox: the video frame rect inside the 16:9 stage container.
  const scale = box.w > 0 && box.h > 0 ? Math.min(box.w / srcW, box.h / srcH) : 0;
  const frame = {
    x: (box.w - srcW * scale) / 2,
    y: (box.h - srcH * scale) / 2,
    w: srcW * scale,
    h: srcH * scale,
  };

  return (
    <div className="panel p-2">
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
      <div className="mt-2 flex flex-wrap items-center gap-2 px-1 pb-1">
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
        </div>
      </div>
    </div>
  );
}
