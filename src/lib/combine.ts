import { frameAt } from "./times";
import type { ClipSpec, VideoInfo } from "./types";

/**
 * Combined export: several same-name clips concatenated into ONE mp4
 * "highlights" file (MP4 only - the combined job never produces
 * gif/avif). These helpers describe the group; the runner (lib/runner.ts)
 * executes it.
 */

/** The combine key of a note: trimmed + lowercased; "" = not combinable. */
export function combineKey(note: string): string {
  return note.trim().toLowerCase();
}

/**
 * Group the clips for a combined export: clips sharing the same non-empty
 * note land in one group (list order = part order of the combined file);
 * nameless clips and singletons each keep their own group.
 */
export function groupCombine(clips: ClipSpec[]): ClipSpec[][] {
  const byKey = new Map<string, ClipSpec[]>();
  const groups: ClipSpec[][] = [];
  for (const c of clips) {
    const key = combineKey(c.note);
    if (key === "") {
      groups.push([c]);
      continue;
    }
    let g = byKey.get(key);
    if (!g) {
      g = [];
      byKey.set(key, g);
      groups.push(g);
    }
    g.push(c);
  }
  return groups;
}

/** Fade length (seconds) on each edge of a combined part. */
export const COMBO_FADE_SECONDS = 0.5;

/**
 * Per-edge fade, clamped to half the part: on a part shorter than 1s the
 * in and out fades would overlap past the midpoint, so each gets at most
 * dur/2.
 */
export function comboFade(dur: number): number {
  return Math.min(COMBO_FADE_SECONDS, dur / 2);
}

/**
 * Total duration of a combined file: the sum of each part's cut duration
 * (start floored to the frame grid, the same floor the cuts use).
 */
export function comboDuration(clips: ClipSpec[], videoFps: number): number {
  let total = 0;
  for (const c of clips) total += c.end - frameAt(c.start, videoFps);
  return total;
}

/**
 * Target frame of the combined file: the FIRST clip's effective size
 * (its crop when cropped, else the source). Every part is scaled/padded
 * to it, so the concat never mixes resolutions.
 */
export function comboTarget(clips: ClipSpec[], video: VideoInfo): { w: number; h: number } {
  const crop = clips[0].crop;
  return crop ? { w: crop.w, h: crop.h } : { w: video.width, h: video.height };
}
