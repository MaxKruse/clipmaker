import type { CropBox } from "./crop";

export type Format = "mp4" | "gif" | "avif";

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
  stage: string | null;
  pct: number;
  outputs: JobOutput[];
  warning?: string;
  error?: string;
  createdAt: number;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function defaultClip(note = ""): ClipSpec {
  return {
    id: newId(),
    note,
    start: 0,
    end: 5,
    crop: null,
    formats: ["mp4", "gif"],
    audio: true,
    fps: 60,
    quality: { mode: "source", kbit: 0 },
    anim: { fps: 30, maxMB: 48, maxEdge: 1024 },
  };
}
