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
 * Target frame of the combined file: the LARGEST clip's effective size
 * (its crop when cropped, else the source), by area - the biggest part
 * keeps its own size and every smaller part is scaled/padded to it, so
 * the concat never mixes resolutions and never upscales the form-giving
 * part. Equal areas: the earlier clip in list order wins.
 */
export function comboTarget(clips: ClipSpec[], video: VideoInfo): { w: number; h: number } {
  let best: { w: number; h: number } | null = null;
  for (const c of clips) {
    const t = c.crop ? { w: c.crop.w, h: c.crop.h } : { w: video.width, h: video.height };
    if (!best || t.w * t.h > best.w * best.h) best = t;
  }
  return best!;
}

// The sharable combined tier: one short file that represents every part -
// each part contributes its MIDDLE section (~3 min of content total),
// the sections are stitched with fades, re-encoded at a fixed 30fps, the
// longest edge at one of the fixed rungs, the first rung that lands under
// the cap wins.
/** Fixed frame rate of the sharable combined file (the full tier keeps the group fps). */
export const COMBO_SHARE_FPS = 30;
/** Size cap of the sharable combined file, in MB. */
export const COMBO_SHARE_MAX_MB = 48;
/** CRF of the sharable combined file (quality-based, so a smaller rung is a smaller file). */
export const COMBO_SHARE_CRF = 20;
/** Longest-edge rungs of the sharable combined file, highest quality first. */
export const COMBO_SHARE_EDGES = [1080, 768, 512, 256];

/**
 * Ladder rungs of the sharable combined file: the frame's own longest
 * edge first (the natural quality of the sections - never upscaled),
 * then the fixed edges scaled to the same cap, even-floored, descending
 * and deduped - a 720p tier stays [720, 512, 256], a 1080p tier starts
 * at full res [1920, 1080, 768, 512, 256], a 700p tier prepends its own
 * edge [700, 512, 256].
 */
export function comboShareRungs(w: number, h: number): number[] {
  const cap = evenFloor(Math.max(w, h));
  const rungs: number[] = [cap];
  for (const e of COMBO_SHARE_EDGES) {
    const rung = Math.min(e, cap);
    if (rungs[rungs.length - 1] !== rung) rungs.push(rung);
  }
  return rungs;
}

/**
 * Target content length (seconds) of the sharable highlights file: the
 * per-part middle-section length is this divided by the part count,
 * clamped to MIN..MAX, so a group of two parts gets 15s middles and a
 * group of 24+ parts gets 8s.
 */
export const COMBO_SHARE_SECTION_TOTAL = 180;
/** Minimum middle-section length per part (a shorter part gives its whole length). */
export const COMBO_SHARE_SECTION_MIN = 8;
/** Maximum middle-section length per part. */
export const COMBO_SHARE_SECTION_MAX = 15;

/**
 * Middle-section cuts of the sharable highlights file: every part
 * contributes the middle of its own cut (a part shorter than its section
 * gives its whole length), the section start frame-aligned on the group's
 * frame grid. One short watchable file no matter how long the full tier
 * is - no part splitting.
 */
export function comboShareSections(durs: number[], fps: number): { ss: number; dur: number }[] {
  const base = Math.min(
    Math.max(COMBO_SHARE_SECTION_TOTAL / Math.max(durs.length, 1), COMBO_SHARE_SECTION_MIN),
    COMBO_SHARE_SECTION_MAX,
  );
  return durs.map((d) => {
    const dur = Math.min(base, d);
    return { ss: frameAt((d - dur) / 2, fps), dur };
  });
}
