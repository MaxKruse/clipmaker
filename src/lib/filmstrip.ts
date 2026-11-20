import fs from "node:fs";
import path from "node:path";
import { findBin, run } from "./ffmpeg";
import type { VideoInfo } from "./types";

// ---- Pure, unit-tested -------------------------------------------------

export interface FilmstripPlan {
  /** Seconds between thumbnails. */
  interval: number;
  /** Absolute times to sample, ascending, all < duration. */
  times: number[];
}

/** Minimum spacing, so short videos do not get a thumbnail every frame. */
const MIN_INTERVAL = 2;
/** Hard cap on thumbnails per video: a 62-min VOD stays under this. */
export const MAX_THUMBS = 100;

/**
 * Where to sample a filmstrip for a video of `duration` seconds: one frame
 * every `interval`, capped at `maxThumbs` thumbnails (the interval widens
 * for long videos). A 2s floor keeps short clips dense.
 */
export function filmstripPlan(duration: number, maxThumbs: number = MAX_THUMBS): FilmstripPlan {
  if (!(duration > 0)) return { interval: MIN_INTERVAL, times: [] };
  const interval = Math.max(MIN_INTERVAL, Math.ceil(duration / maxThumbs));
  const times: number[] = [];
  for (let t = 0; t < duration; t += interval) times.push(t);
  return { interval, times };
}

// ---- Server-only: cached generation, single-flight ---------------------
// The page must never import this module - only the filmstrip routes may.

const THUMBS_DIR = path.join(process.cwd(), "thumbs");

export interface FilmstripFrame {
  time: number;
  name: string;
}

export interface FilmstripStatus {
  ready: boolean;
  interval: number;
  total: number;
  done: number;
}

interface FilmstripState {
  interval: number;
  total: number;
  done: number;
  ready: boolean;
  promise: Promise<void> | null;
}

const states = new Map<string, FilmstripState>();

function thumbDir(videoId: string): string {
  return path.join(THUMBS_DIR, videoId);
}
function thumbPath(videoId: string, t: number): string {
  return path.join(thumbDir(videoId), `${t}.jpg`);
}

/** Delete a video's cached filmstrip frames (video removal). */
export function removeThumbsForVideo(videoId: string): void {
  fs.rmSync(path.join(THUMBS_DIR, videoId), { recursive: true, force: true });
}
/** One fast-seek frame at time t, scaled to a small jpeg. Never rejects. */
function extractThumb(video: VideoInfo, t: number): Promise<void> {
  const args = [
    "-ss", String(t),
    "-i", video.path,
    "-frames:v", "1",
    "-vf", "scale=240:-2",
    "-q:v", "5",
    "-y", thumbPath(video.id, t),
  ];
  return run(findBin("ffmpeg"), args, 30_000).then(() => undefined);
}

/** Run fn over items with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

function presentCount(video: VideoInfo): number {
  let n = 0;
  for (const t of filmstripPlan(video.duration).times) {
    if (fs.existsSync(thumbPath(video.id, t))) n++;
  }
  return n;
}

/**
 * Start generating a video's filmstrip if it is not ready yet (fast-seek one
 * frame per planned time, 6 at a time, cached on disk). Resumable: frames
 * already on disk are skipped, so a partial run finishes the rest.
 */
function startGeneration(video: VideoInfo, st: FilmstripState): void {
  const missing = filmstripPlan(video.duration).times.filter((t) => !fs.existsSync(thumbPath(video.id, t)));
  if (missing.length === 0) {
    st.done = st.total;
    st.ready = true;
    return;
  }
  st.promise = pool(missing, 6, (t) => extractThumb(video, t).catch(() => undefined)).then(() => {
    st.done = presentCount(video);
    st.ready = true;
  }).finally(() => {
    st.promise = null;
  });
}

/**
 * Current filmstrip status for a video; kicks off generation on first use.
 * `ready` flips to true once the (resumable) generation pass has run; a
 * later call returns the finished status immediately.
 */
export function filmstrip(video: VideoInfo): FilmstripStatus {
  let st = states.get(video.id);
  if (!st) {
    fs.mkdirSync(thumbDir(video.id), { recursive: true });
    const plan = filmstripPlan(video.duration);
    const done = presentCount(video);
    st = { interval: plan.interval, total: plan.times.length, done, ready: done === plan.times.length, promise: null };
    states.set(video.id, st);
  }
  if (!st.ready && !st.promise) startGeneration(video, st);
  return { ready: st.ready, interval: st.interval, total: st.total, done: st.done };
}

/** The finished frames that exist on disk (time + file name). */
export function filmstripFrames(video: VideoInfo): FilmstripFrame[] {
  const frames: FilmstripFrame[] = [];
  for (const t of filmstripPlan(video.duration).times) {
    if (fs.existsSync(thumbPath(video.id, t))) frames.push({ time: t, name: `${t}.jpg` });
  }
  return frames;
}

/** A cached thumbnail as bytes, or null when absent/invalid. */
export async function readThumb(videoId: string, t: number): Promise<Buffer | null> {
  if (!Number.isFinite(t) || t < 0 || !Number.isInteger(t)) return null;
  if (!videoId || videoId.includes("/") || videoId.includes("\\") || videoId.includes("..")) return null;
  const dir = path.resolve(THUMBS_DIR);
  const file = path.resolve(path.join(THUMBS_DIR, videoId, `${t}.jpg`));
  if (!file.startsWith(dir + path.sep)) return null;
  try {
    return await fs.promises.readFile(file);
  } catch {
    return null;
  }
}
