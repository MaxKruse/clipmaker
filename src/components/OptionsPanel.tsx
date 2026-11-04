"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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

/** A titled group below a divider: keeps the panel scannable instead of
 * one flat list of controls. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <span className="label">{title}</span>
      {children}
    </div>
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
    <div data-clip-options className="panel flex shrink-0 flex-col gap-3 p-3">
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

      <Section title="Formats">
        <div className="flex flex-wrap items-center gap-2">
          {(["mp4", "gif", "avif"] as Format[]).map((f) => (
            <button
              key={f}
              className={pill(draft.formats.includes(f))}
              title={
                f === "mp4"
                  ? "H.264 video with audio - the default"
                  : f === "gif"
                    ? "GIF: plays anywhere, but heavy for its quality"
                    : "animated AVIF (AV1): much better quality per byte than GIF, but a slower encode"
              }
              onClick={() => toggleFormat(f)}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>
      </Section>

      {draft.formats.includes("mp4") && (
        <Section title="MP4 video">
          <div className="grid grid-cols-2 gap-2">
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
            <label className="flex cursor-pointer items-end gap-2 pb-2 text-sm">
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
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="label">Quality</span>
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
        </Section>
      )}

      {(draft.formats.includes("gif") || draft.formats.includes("avif")) && (
        <Section title="GIF / AVIF">
          <p className="text-xs leading-relaxed text-muted">
            Each clip exports two versions: a full-res original, and a size-capped copy in{" "}
            <span className="font-mono">sharable/</span>.
          </p>
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1.5">
              <span className="label">Frame rate</span>
              <select
                className="input w-full"
                value={draft.anim.fps}
                onChange={(e) => onChange({ anim: { ...draft.anim, fps: Number(e.target.value) } })}
              >
                <option value={15}>15 fps</option>
                <option value={20}>20 fps</option>
                <option value={25}>25 fps</option>
                <option value={30}>30 fps</option>
                <option value={60}>60 fps</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="label">Sharable size cap</span>
              <select
                className="input w-full"
                value={draft.anim.maxMB}
                onChange={(e) => onChange({ anim: { ...draft.anim, maxMB: Number(e.target.value) } })}
              >
                <option value={10}>10 MB</option>
                <option value={25}>25 MB</option>
                <option value={48}>48 MB</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="label">Sharable max edge</span>
              <select
                className="input w-full"
                value={draft.anim.maxEdge}
                onChange={(e) => onChange({ anim: { ...draft.anim, maxEdge: Number(e.target.value) } })}
              >
                <option value={256}>256 px</option>
                <option value={512}>512 px</option>
                <option value={768}>768 px</option>
                <option value={1024}>1024 px</option>
                <option value={1280}>1280 px</option>
                <option value={1440}>1440 px</option>
              </select>
            </div>
          </div>
        </Section>
      )}

      <Section title="Crop">
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
      </Section>
    </div>
  );
}
