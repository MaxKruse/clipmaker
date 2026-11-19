import type { CropBox } from "./crop";
import type { JobStage } from "./stages";

export type Format = "mp4" | "gif" | "avif";

/** Selectable values, shared by the clip validator and the options panel. */
export const FORMAT_OPTIONS: Format[] = ["mp4", "gif", "avif"];
export const MP4_FPS_OPTIONS = [25, 30, 60];
export const ANIM_FPS_OPTIONS = [15, 20, 25, 30, 60];
export const ANIM_MAX_MB_OPTIONS = [10, 25, 48];
export const ANIM_MAX_EDGE_OPTIONS = [256, 512, 768, 1000, 1280, 1440];

export interface VideoInfo {
  id: string;
  name: string;
  path: string;
  uploaded: boolean;
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  videoKbit: number | null;
  audioKbit: number | null;
  formatKbit: number | null;
  sizeBytes: number;
}

/** Animated-image export options (GIF and AVIF share the same knobs). */
export interface AnimOpts {
  /** Frame rate of the shared intermediate cut and both tiers. */
  fps: number;
  maxMB: number;
  maxEdge: number;
}

export interface QualityOpts {
  mode: "source" | "manual";
  kbit: number;
}

/** Export options for NEW and imported clips: the ClipSpec fields a
 * user can preset. Existing clips always keep their own settings. */
export interface ClipDefaults {
  formats: Format[];
  audio: boolean;
  fps: number;
  quality: QualityOpts;
  anim: AnimOpts;
}

export function defaultClipDefaults(): ClipDefaults {
  return {
    // mp4 + avif are the defaults; gif is the opt-in fallback.
    formats: ["mp4", "avif"],
    audio: true,
    fps: 60,
    quality: { mode: "source", kbit: 0 },
    anim: { fps: 30, maxMB: 48, maxEdge: 1000 },
  };
}

/** One clip: a range of a video plus its export options. */
export interface ClipSpec {
  id: string;
  note: string;
  start: number;
  end: number;
  crop: CropBox | null;
  formats: Format[];
  audio: boolean;
  fps: number;
  quality: QualityOpts;
  anim: AnimOpts;
}

export interface JobOutput {
  kind: Format;
  /** Path relative to out/<videoId>/; the sharable tier sits in sharable/. */
  name: string;
  size: number;
  /** "full" = full-quality/full-res original, "sharable" = size-capped copy. */
  tier?: "full" | "sharable";
}

export type JobStatus = "queued" | "running" | "done" | "error";

export interface Job {
  id: string;
  videoId: string;
  videoName: string;
  clip: ClipSpec;
  /** 1-based clip number used for output naming. */
  clipNo: number;
  status: JobStatus;
  stage: JobStage | null;
  pct: number;
  outputs: JobOutput[];
  warning?: string;
  error?: string;
  createdAt: number;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** A brand-new clip: zeroed range, export options from `d`
 * (the shipped defaults when omitted). */
export function defaultClip(note = "", d: ClipDefaults = defaultClipDefaults()): ClipSpec {
  return {
    id: newId(),
    note,
    start: 0,
    end: 5,
    crop: null,
    formats: [...d.formats],
    audio: d.audio,
    fps: d.fps,
    quality: { ...d.quality },
    anim: { ...d.anim },
  };
}
