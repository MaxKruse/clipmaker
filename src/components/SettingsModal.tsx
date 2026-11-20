"use client";

import { useRef, type ReactNode } from "react";
import { Dialog } from "@/components/Dialog";
import {
  ANIM_FPS_OPTIONS,
  ANIM_MAX_EDGE_OPTIONS,
  ANIM_MAX_MB_OPTIONS,
  FORMAT_OPTIONS,
  MP4_FPS_OPTIONS,
  defaultClipDefaults,
  defaultsSummary,
  toggleFormatIn,
  type ClipDefaults,
  type Format,
} from "@/lib/types";

interface Props {
  /** The persisted new-clip defaults (.data/defaults.json). */
  defaults: ClipDefaults;
  /** Every change lands here (the page PUTs /api/defaults). */
  onChange: (d: ClipDefaults) => void;
  onClose: () => void;
}

/** One-line hint under each format pill. */
const FORMAT_HINTS: Record<Format, string> = {
  mp4: "H.264 video with audio - the usual choice",
  gif: "plays anywhere, but heavy for its quality",
  avif: "AV1: much better quality per byte than GIF, but a slower encode",
};

/** A titled section with an optional explanatory line, matching the
 * OptionsPanel section rhythm (divider, label, content). */
function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <span className="label">{title}</span>
      {desc && <p className="text-[11px] leading-relaxed text-muted">{desc}</p>}
      {children}
    </div>
  );
}

/**
 * The settings page: the detailed editor for the persisted new-clip
 * defaults (.data/defaults.json) - the options every new and imported
 * clip is created with. Existing clips keep their own settings. Every
 * change saves immediately; the live summary line shows what a new
 * clip picks up right now.
 */
export function SettingsModal({ defaults, onChange, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const set = (patch: Partial<ClipDefaults>) => onChange({ ...defaults, ...patch });
  // toggleFormatIn keeps at least one format (null = no change).
  const toggleFormat = (f: Format) => {
    const formats = toggleFormatIn(defaults.formats, f);
    if (formats) set({ formats });
  };
  // Reset overwrites the user's choices - confirm first.
  const reset = () => {
    if (confirm("Reset the new-clip defaults to the shipped values?")) onChange(defaultClipDefaults());
  };

  const pill = (on: boolean) =>
    on
      ? "rounded-full border border-accent/60 bg-accent/15 px-2.5 py-0.5 font-mono text-[11px] text-accent"
      : "chip cursor-pointer hover:border-accent/40";

  return (
    <Dialog
      label="Settings"
      onClose={onClose}
      overlay="items-center justify-center p-4"
      panel="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden"
      focusRef={closeRef}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">Settings</h2>
        <button ref={closeRef} className="btn btn-sm" onClick={onClose}>
          close
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 scrollbar-thin">
        <div>
          <p className="text-xs leading-relaxed text-muted">
            New-clip defaults - the export options every <span className="text-fg">new</span> and{" "}
            <span className="text-fg">imported</span> clip starts with. Existing clips keep their own
            settings. Saved to <span className="font-mono">.data/defaults.json</span> on every change.
          </p>
          <p className="mt-2 rounded-md border border-border bg-panel2 px-2.5 py-1.5 font-mono text-[11px] text-fg">
            {defaultsSummary(defaults)}
          </p>
        </div>

        <Section title="Formats">
          <div className="flex flex-wrap items-center gap-2">
            {FORMAT_OPTIONS.map((f) => (
              <button key={f} className={pill(defaults.formats.includes(f))} onClick={() => toggleFormat(f)}>
                {f.toUpperCase()}
              </button>
            ))}
          </div>
          {FORMAT_OPTIONS.filter((f) => defaults.formats.includes(f)).map((f) => (
            <p key={f} className="text-[11px] leading-relaxed text-muted">
              {f.toUpperCase()}: {FORMAT_HINTS[f]}
            </p>
          ))}
        </Section>

        <Section
          title="MP4 video"
          desc="Source quality matches the source video's bitrate (scaled to the frame rate); manual sets an exact one."
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <span className="label">Frame rate</span>
              <select
                className="input w-full"
                value={defaults.fps}
                onChange={(e) => set({ fps: Number(e.target.value) })}
              >
                {MP4_FPS_OPTIONS.map((f) => (
                  <option key={f} value={f}>
                    {f} fps
                  </option>
                ))}
              </select>
            </div>
            <label className="flex cursor-pointer items-end gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-accent"
                checked={defaults.audio}
                onChange={(e) => set({ audio: e.target.checked })}
              />
              Audio
            </label>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="label">Quality</span>
            <div className="flex flex-wrap items-center gap-2">
              {(["source", "manual"] as const).map((m) => (
                <button
                  key={m}
                  className={pill(defaults.quality.mode === m)}
                  onClick={() => set({ quality: { ...defaults.quality, mode: m } })}
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
                    set({ quality: { ...defaults.quality, kbit: Number(e.target.value) || 0 } })
                  }
                />
              )}
            </div>
          </div>
        </Section>

        <Section
          title="GIF / AVIF"
          desc="Each clip exports two versions per format: a full-res original (uncapped) and a size-capped copy in sharable/. AV1 encodes are slow - a clip that includes AVIF warns in yellow above 45s and red above 60s."
        >
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1.5">
              <span className="label">Frame rate</span>
              <select
                className="input w-full"
                value={defaults.anim.fps}
                onChange={(e) => set({ anim: { ...defaults.anim, fps: Number(e.target.value) } })}
              >
                {ANIM_FPS_OPTIONS.map((f) => (
                  <option key={f} value={f}>
                    {f} fps
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="label">Sharable size cap</span>
              <select
                className="input w-full"
                value={defaults.anim.maxMB}
                onChange={(e) => set({ anim: { ...defaults.anim, maxMB: Number(e.target.value) } })}
              >
                {ANIM_MAX_MB_OPTIONS.map((mb) => (
                  <option key={mb} value={mb}>
                    {mb} MB
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="label">Sharable max edge</span>
              <select
                className="input w-full"
                value={defaults.anim.maxEdge}
                onChange={(e) => set({ anim: { ...defaults.anim, maxEdge: Number(e.target.value) } })}
              >
                {ANIM_MAX_EDGE_OPTIONS.map((px) => (
                  <option key={px} value={px}>
                    {px} px
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Section>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-3">
        <span className="text-xs text-muted">saved on change</span>
        <button className="btn btn-sm btn-danger" onClick={reset}>
          Reset to defaults
        </button>
      </div>
    </Dialog>
  );
}
