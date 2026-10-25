"use client";

import { useEffect, useRef, useState } from "react";
import { resolveSourceKbit, targetVideoKbit } from "@/lib/bitrate";
import { parseTime } from "@/lib/times";
import type { ClipSpec, Format, VideoInfo } from "@/lib/types";
import type { Aspect } from "./CropOverlay";

function TimeInput({ value, onCommit }: { value: number; onCommit: (t: number) => void }) {
  const [txt, setTxt] = useState(value.toFixed(2));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setTxt(value.toFixed(2));
  }, [value]);
  const commit = () => {
    let t = NaN;
    try {
      t = parseTime(txt);
    } catch {
      // fall back to the last good value
    }
    if (Number.isFinite(t)) {
      setTxt(t.toFixed(2));
      if (Math.abs(t - value) > 1e-6) onCommit(t);
    } else {
      setTxt(value.toFixed(2));
    }
  };
  return (
    <input
      className="input w-full font-mono"
      value={txt}
      placeholder="0:00.00"
      onFocus={() => (focused.current = true)}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

interface Props {
  video: VideoInfo;
  /** In/out bounds; null = no range set (inputs disabled). */
  inOut: { start: number; end: number } | null;
  draft: ClipSpec;
  aspect: Aspect;
  onChange: (patch: Partial<ClipSpec>) => void;
  onAspect: (a: Aspect) => void;
  onClearCrop: () => void;
}

export function OptionsPanel({
  video, draft, inOut, aspect, onChange, onAspect, onClearCrop,
}: Props) {
  const toggleFormat = (f: Format) => {
    const has = draft.formats.includes(f);
    if (has && draft.formats.length === 1) return; // at least one format
    onChange({ formats: has ? draft.formats.filter((x) => x !== f) : [...draft.formats, f] });
  };

  const srcKbit = resolveSourceKbit(video);
  const autoKbit = targetVideoKbit(srcKbit, video.fps, draft.fps);

  const pill = (on: boolean) =>
    on
      ? "rounded-full border border-accent/60 bg-accent/15 px-2.5 py-0.5 font-mono text-[11px] text-accent"
      : "chip cursor-pointer hover:border-accent/40";

  return (
    <div className="panel flex flex-col gap-3 p-3">
      <span className="label">Clip options</span>

      <div className="flex flex-col gap-1.5">
        <span className="label">Note</span>
        <input
          className="input w-full"
          value={draft.note}
          placeholder="what is this clip?"
          onChange={(e) => onChange({ note: e.target.value })}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1.5">
          <span className="label">In</span>
          {inOut ? (
            <TimeInput value={inOut.start} onCommit={(t) => onChange({ start: Math.min(t, inOut.end - 0.2) })} />
          ) : (
            <input className="input w-full font-mono" value="" placeholder="--:--" disabled />
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="label">Out</span>
          {inOut ? (
            <TimeInput value={inOut.end} onCommit={(t) => onChange({ end: Math.max(t, inOut.start + 0.2) })} />
          ) : (
            <input className="input w-full font-mono" value="" placeholder="--:--" disabled />
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="label">Formats</span>
        {(["mp4", "gif"] as Format[]).map((f) => (
          <button key={f} className={pill(draft.formats.includes(f))} onClick={() => toggleFormat(f)}>
            {f.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-[#58a6ff]"
            disabled={!video.hasAudio}
            checked={draft.audio && video.hasAudio}
            onChange={(e) => onChange({ audio: e.target.checked })}
          />
          Audio
          {!video.hasAudio && <span className="text-[11px] text-muted">(none in source)</span>}
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="label">Frame rate</span>
          <select
            className="input w-full"
            value={draft.fps}
            onChange={(e) => onChange({ fps: Number(e.target.value) })}
          >
            <option value={25}>25 fps</option>
            <option value={30}>30 fps</option>
            <option value={60}>60 fps</option>
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="label">MP4 quality</span>
        <div className="flex flex-wrap items-center gap-2">
          {(["source", "manual"] as const).map((m) => (
            <button
              key={m}
              className={pill(draft.quality.mode === m)}
              onClick={() => onChange({ quality: { ...draft.quality, mode: m } })}
            >
              {m}
            </button>
          ))}
          {draft.quality.mode === "source" ? (
            <span className="chip">video ~{autoKbit}k</span>
          ) : (
            <input
              type="number"
              min={250}
              step={50}
              className="input w-24 font-mono"
              value={draft.quality.kbit || ""}
              placeholder="kbit"
              onChange={(e) => onChange({ quality: { ...draft.quality, kbit: Number(e.target.value) || 0 } })}
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1.5">
          <span className="label">GIF size cap</span>
          <select
            className="input w-full"
            value={draft.gif.maxMB}
            onChange={(e) => onChange({ gif: { ...draft.gif, maxMB: Number(e.target.value) } })}
          >
            <option value={10}>10 MB</option>
            <option value={25}>25 MB</option>
            <option value={48}>48 MB</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="label">GIF max edge</span>
          <select
            className="input w-full"
            value={draft.gif.maxEdge}
            onChange={(e) => onChange({ gif: { ...draft.gif, maxEdge: Number(e.target.value) } })}
          >
            <option value={256}>256 px</option>
            <option value={512}>512 px</option>
            <option value={768}>768 px</option>
            <option value={1024}>1024 px</option>
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="label">Crop</span>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input" value={aspect} onChange={(e) => onAspect(e.target.value as Aspect)}>
            <option value="free">free</option>
            <option value="16:9">16:9</option>
            <option value="1:1">1:1</option>
            <option value="source">source</option>
          </select>
          {draft.crop && (
            <>
              <span className="chip">
                {draft.crop.w}x{draft.crop.h} @ ({draft.crop.x},{draft.crop.y})
              </span>
              <button className="btn btn-sm btn-danger" onClick={onClearCrop}>
                clear
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
