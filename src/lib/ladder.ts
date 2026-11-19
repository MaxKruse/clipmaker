export interface Rung {
  edge: number;
  fps: number;
}

// Quality ladder (skill recipe, 1000px baseline): ping-pong the two
// quality axes - first the fps (anim fps -> 5/6 x anim fps, the recipe's
// 30 -> 25), then one edge step down at the anim fps again, and so on.
const FPS_STEP = 5 / 6;
const EDGE_RATIOS = [1, 0.75, 0.625, 0.5, 0.375, 0.25]; // 1000, 750, 625, 500, 375, 250
const EMERGENCY_RATIO = 0.1875; // 186px at the 1000 baseline

export function evenFloor(x: number): number {
  return Math.max(2, Math.floor(x / 2) * 2);
}

/** Which axis of the full-tier frame holds the longest edge. */
export type LongAxis = "w" | "h";

/**
 * Cap and scale axis for the sharable ladder: the cap is the user's
 * maxEdge limited to the full tier's LONGEST edge (never upscaling), and
 * `axis` is the frame's longest edge - the ladder's `edge` is scaled on
 * that axis, so a portrait crop's height stays under maxEdge too.
 */
export function sharableCap(maxEdge: number, w: number, h: number): { cap: number; axis: LongAxis } {
  return { cap: Math.min(maxEdge, evenFloor(Math.max(w, h))), axis: w >= h ? "w" : "h" };
}

/**
 * Sharable ladder, highest quality first: each edge step is tried at the
 * anim fps and then at the reduced fps (5/6 x anim fps); when neither
 * fits, the edge drops one step and the fps goes back up. Edges stay
 * even; maxEdge must already be capped by the crop/source longest edge,
 * so the sharable tier never upscales.
 */
export function buildLadder(maxEdge: number, fps: number): Rung[] {
  const low = Math.max(1, Math.round(fps * FPS_STEP));
  const rungs: Rung[] = [];
  for (const r of EDGE_RATIOS) {
    const edge = evenFloor(maxEdge * r);
    rungs.push({ edge, fps }, { edge, fps: low });
  }
  return rungs;
}

/** Last-resort rung tried when every ladder rung exceeds the size cap. */
export function emergencyRung(maxEdge: number, fps: number): Rung {
  return { edge: evenFloor(maxEdge * EMERGENCY_RATIO), fps: Math.max(1, Math.round(fps * FPS_STEP)) };
}

// AVIF sharable ladder: the three quality axes, in order - CRF (25 -> 36,
// the recipe's step of 4), then the GIF ping-pong grid (fps: anim -> 5/6 x
// anim, edge: 1.0 -> 0.25). A CRF step is only degraded after the whole
// fps/edge grid misses the cap, so crf 25 (the best quality) is tried at
// every grid shape before the quality drops.
const AVIF_CRF_STEPS = [25, 29, 33, 36];
const AVIF_EMERGENCY_CRF = 40;

export interface AvifRung {
  edge: number;
  fps: number;
  crf: number;
}

/**
 * AVIF sharable ladder, highest quality first: sweeps the fps/edge
 * fps/edge ping-pong grid (same as GIF) at the current CRF, degrades the CRF only
 * after the whole grid misses the cap, and sweeps again. Edges stay even;
 * maxEdge must already be capped by the crop/source longest edge (no upscale).
 */
export function buildAvifLadder(maxEdge: number, fps: number): AvifRung[] {
  const rungs: AvifRung[] = [];
  for (const crf of AVIF_CRF_STEPS) {
    for (const r of buildLadder(maxEdge, fps)) rungs.push({ ...r, crf });
  }
  return rungs;
}

/** Last-resort AVIF rung: the best grid shape (max edge at anim fps) at the emergency CRF. */
export function avifEmergencyRung(maxEdge: number, fps: number): AvifRung {
  return { edge: maxEdge, fps, crf: AVIF_EMERGENCY_CRF };
}
