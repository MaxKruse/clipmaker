"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { avifDurationLevel, avifWarningText } from "@/lib/avif";
import { resolveSourceKbit, targetVideoKbit } from "@/lib/bitrate";
import { formatTime, parseTime } from "@/lib/times";
import { ANIM_FPS_OPTIONS, ANIM_MAX_EDGE_OPTIONS, ANIM_MAX_MB_OPTIONS, FORMAT_OPTIONS, MIN_CLIP_SECONDS, MP4_FPS_OPTIONS, toggleFormatIn, type ClipDefaults, type ClipSpec, type Format, type VideoInfo } from "@/lib/types";
import type { Aspect } from "./CropOverlay";

function TimeInput({ value, onCommit }: { value: number; onCommit: (t: number) => void }) {
  const [txt, setTxt] = useState(formatTime(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setTxt(formatTime(value));
  }, [value]);
  const commit = () => {
    let t = NaN;
    try {
      t = parseTime(txt);
    } catch {
      // fall back to the last good value
    }
    if (Number.isFinite(t)) {
      setTxt(formatTime(t));
      if (Math.abs(t - value) > 1e-6) onCommit(t);
    } else {
      setTxt(formatTime(value));
    }
  };
  return (
    <input
      className="input w-full font-mono"
      value={txt}
      placeholder="m:ss.mmm"
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

/** A collapsible titled group: the summary line stays visible so the
 * current settings read at a glance; click to expand the controls.
 * Used for the format-detail sections to keep the rail short. */
function Collapsible({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-border pt-3">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setOpen(!open)}
      >
        <span className="label">{title}</span>
        <span className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-muted">{summary}</span>
          <span className={`text-muted transition-transform duration-150 ${open ? "rotate-90" : ""}`}>&#8250;</span>
        </span>
      </button>
      {open && <div className="mt-2 flex flex-col gap-2">{children}</div>}
    </div>
  );
}

interface Props {
  video: VideoInfo;
  /** In/out bounds; null = no range set (inputs disabled). */
  inOut: { start: number; end: number } | null;
  draft: ClipSpec;
  aspect: Aspect;
  /** Export options for new and imported clips (persisted). */
  defaults: ClipDefaults;
  onChange: (patch: Partial<ClipSpec>) => void;
  onDefaultsChange: (d: ClipDefaults) => void;
  onAspect: (a: Aspect) => void;
  onClearCrop: () => void;
}

export function OptionsPanel({
  video, draft, inOut, aspect, defaults, onChange, onDefaultsChange, onAspect, onClearCrop,
}: Props) {
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  // toggleFormatIn keeps at least one format (null = no change).
  const toggleFormat = (f: Format) => {
    const formats = toggleFormatIn(draft.formats, f);
    if (formats) onChange({ formats });
  };
  const toggleDefaultsFormat = (f: Format) => {
    const formats = toggleFormatIn(defaults.formats, f);
    if (formats) onDefaultsChange({ ...defaults, formats });
  };

  const srcKbit = resolveSourceKbit(video);
  const autoKbit = targetVideoKbit(srcKbit, video.fps, draft.fps);
  // AVIF encodes are slow: flag long ones (yellow above 45s, red above 60s).
  const avifLevel = draft.formats.includes("avif") ? avifDurationLevel(draft.end - draft.start) : "none";

  const pill = (on: boolean) =>
    on
      ? "rounded-full border border-accent/60 bg-accent/15 px-2.5 py-0.5 font-mono text-[11px] text-accent"
      : "chip cursor-pointer hover:border-accent/40";

  // h-full/min-h-0: the panel fills its (possibly user-resized) row;
  // overflow-y-auto scrolls the form when the row is shorter than the
  // natural content.
  return (
    <div data-clip-options className="panel scrollbar-thin flex h-full min-h-0 shrink-0 flex-col gap-3 overflow-y-auto p-3">
      <div className="flex items-center justify-between">
        <span className="label">Clip options</span>
        <button
          className={`btn btn-sm ${defaultsOpen ? "border-accent/60 text-accent" : ""}`}
          onClick={() => setDefaultsOpen(!defaultsOpen)}
        >
          {defaultsOpen ? "Hide defaults" : "Defaults"}
        </button>
      </div>

      {defaultsOpen && (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-panel2 p-2.5">
          <p className="text-[11px] leading-relaxed text-muted">
            Defaults for new and imported clips. Existing clips keep their own settings.
          </p>
          <div>
            <span className="label">Formats</span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {FORMAT_OPTIONS.map((f) => (
                <button key={f} className={pill(defaults.formats.includes(f))} onClick={() => toggleDefaultsFormat(f)}>
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <span className="label">MP4 frame rate</span>
              <select
                className="input w-full"
                value={defaults.fps}
                onChange={(e) => onDefaultsChange({ ...defaults, fps: Number(e.target.value) })}
              >
                {MP4_FPS_OPTIONS.map((f) => (
                  <option key={f} value={f}>{f} fps</option>
                ))}
              </select>
            </div>
            <label className="flex cursor-pointer items-end gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-accent"
                checked={defaults.audio}
                onChange={(e) => onDefaultsChange({ ...defaults, audio: e.target.checked })}
              />
              Audio
            </label>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="label">MP4 quality</span>
            <div className="flex flex-wrap items-center gap-2">
              {(["source", "manual"] as const).map((m) => (
                <button
                  key={m}
                  className={pill(defaults.quality.mode === m)}
                  onClick={() => onDefaultsChange({ ...defaults, quality: { ...defaults.quality, mode: m } })}
                >
                  {m}
                </button>
              ))}
              {defaults.quality.mode === "manual" && (
                <input
                  type="number"
                  min={250}
                  step={50}
                  className="input w-24 font-mono"
                  value={defaults.quality.kbit || ""}
                  placeholder="kbit"
                  onChange={(e) =>
                    onDefaultsChange({ ...defaults, quality: { ...defaults.quality, kbit: Number(e.target.value) || 0 } })
                  }
                />
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1.5">
              <span className="label">GIF / AVIF fps</span>
              <select
                className="input w-full"
                value={defaults.anim.fps}
                onChange={(e) => onDefaultsChange({ ...defaults, anim: { ...defaults.anim, fps: Number(e.target.value) } })}
              >
                {ANIM_FPS_OPTIONS.map((f) => (
                  <option key={f} value={f}>{f} fps</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="label">Size cap</span>
              <select
                className="input w-full"
                value={defaults.anim.maxMB}
                onChange={(e) => onDefaultsChange({ ...defaults, anim: { ...defaults.anim, maxMB: Number(e.target.value) } })}
              >
                {ANIM_MAX_MB_OPTIONS.map((mb) => (
                  <option key={mb} value={mb}>{mb} MB</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="label">Max edge</span>
              <select
                className="input w-full"
                value={defaults.anim.maxEdge}
                onChange={(e) => onDefaultsChange({ ...defaults, anim: { ...defaults.anim, maxEdge: Number(e.target.value) } })}
              >
                {ANIM_MAX_EDGE_OPTIONS.map((px) => (
                  <option key={px} value={px}>{px} px</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

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
            <TimeInput value={inOut.start} onCommit={(t) => onChange({ start: Math.min(t, inOut.end - MIN_CLIP_SECONDS) })} />
          ) : (
            <input className="input w-full font-mono" value="" placeholder="--:--" disabled />
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="label">Out</span>
          {inOut ? (
            <TimeInput value={inOut.end} onCommit={(t) => onChange({ end: Math.max(t, inOut.start + MIN_CLIP_SECONDS) })} />
          ) : (
            <input className="input w-full font-mono" value="" placeholder="--:--" disabled />
          )}
        </div>
      </div>

      <Section title="Formats">
        <div className="flex flex-wrap items-center gap-2">
          {FORMAT_OPTIONS.map((f) => (
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
        <Collapsible
          title="MP4 video"
          summary={`${draft.fps} fps · ${draft.quality.mode === "source" ? "~" + autoKbit + "k" : draft.quality.kbit + "k"} · ${draft.audio && video.hasAudio ? "audio" : "no audio"}`}
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <span className="label">Frame rate</span>
              <select
                className="input w-full"
                value={draft.fps}
                onChange={(e) => onChange({ fps: Number(e.target.value) })}
              >
                {MP4_FPS_OPTIONS.map((f) => (
                  <option key={f} value={f}>{f} fps</option>
                ))}
              </select>
            </div>
            <label className="flex cursor-pointer items-end gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-accent"
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
        </Collapsible>
      )}

      {(draft.formats.includes("gif") || draft.formats.includes("avif")) && (
        <Collapsible
          title="GIF / AVIF"
          summary={`${draft.anim.fps} fps · ${draft.anim.maxMB} MB cap · ${draft.anim.maxEdge} px`}
        >
          <p className="text-xs leading-relaxed text-muted">
            Each clip exports two versions: a full-res original, and a size-capped copy in{" "}
            <span className="font-mono">sharable/</span>.
          </p>
          {avifLevel !== "none" && (
            <p className={avifLevel === "danger" ? "text-xs leading-relaxed text-danger" : "text-xs leading-relaxed text-warn"}>
              {avifWarningText(avifLevel, draft.end - draft.start)}.
            </p>
          )}
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1.5">
              <span className="label">Frame rate</span>
              <select
                className="input w-full"
                value={draft.anim.fps}
                onChange={(e) => onChange({ anim: { ...draft.anim, fps: Number(e.target.value) } })}
              >
                {ANIM_FPS_OPTIONS.map((f) => (
                  <option key={f} value={f}>{f} fps</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="label">Sharable size cap</span>
              <select
                className="input w-full"
                value={draft.anim.maxMB}
                onChange={(e) => onChange({ anim: { ...draft.anim, maxMB: Number(e.target.value) } })}
              >
                {ANIM_MAX_MB_OPTIONS.map((mb) => (
                  <option key={mb} value={mb}>{mb} MB</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="label">Sharable max edge</span>
              <select
                className="input w-full"
                value={draft.anim.maxEdge}
                onChange={(e) => onChange({ anim: { ...draft.anim, maxEdge: Number(e.target.value) } })}
              >
                {ANIM_MAX_EDGE_OPTIONS.map((px) => (
                  <option key={px} value={px}>{px} px</option>
                ))}
              </select>
            </div>
          </div>
        </Collapsible>
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
