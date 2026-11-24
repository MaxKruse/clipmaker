import { evenFloor } from "./ladder";
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

// The sharable combined tier: the finished highlights file re-encoded
// small and compact so it can be shared (e.g. chat) - fixed 30fps, the
// longest edge at one of the fixed rungs, the first rung that lands
// under the cap wins.
/** Fixed frame rate of the sharable combined file (the full tier keeps the group fps). */
export const COMBO_SHARE_FPS = 30;
/** Size cap of the sharable combined file, in MB. */
export const COMBO_SHARE_MAX_MB = 48;
/** CRF of the sharable combined file (quality-based, so a smaller rung is a smaller file). */
export const COMBO_SHARE_CRF = 20;
/** Longest-edge rungs of the sharable combined file, highest quality first. */
export const COMBO_SHARE_EDGES = [768, 512, 256];

/**
 * Ladder rungs of the sharable combined file: the fixed edges scaled to
 * the frame's LONGEST edge, capped at the full tier's longest edge (never
 * upscale), even-floored, descending and deduped - a 480p tier starts at
 * 480 instead of re-trying 768, and a 700p tier prepends its own edge.
 */
export function comboShareRungs(w: number, h: number): number[] {
  const cap = evenFloor(Math.max(w, h));
  const rungs: number[] = [];
  for (const e of COMBO_SHARE_EDGES) {
    const rung = Math.min(e, cap);
    if (rungs[rungs.length - 1] !== rung) rungs.push(rung);
  }
  return rungs;
}
