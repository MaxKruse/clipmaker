export interface Rung {
  edge: number;
  fps: number;
}

// Quality ladder (skill recipe, 1024px baseline): ping-pong the two
// quality axes - first the fps (anim fps -> 5/6 x anim fps, the recipe's
// 30 -> 25), then one edge step down at the anim fps again, and so on.
const FPS_STEP = 5 / 6;
const EDGE_RATIOS = [1, 0.75, 0.625, 0.5, 0.375, 0.25]; // 1024, 768, 640, 512, 384, 256
const EMERGENCY_RATIO = 0.1875; // 192px at the 1024 baseline

export function evenFloor(x: number): number {
  return Math.max(2, Math.floor(x / 2) * 2);
}

/**
 * Sharable ladder, highest quality first: each edge step is tried at the
 * anim fps and then at the reduced fps (5/6 x anim fps); when neither
 * fits, the edge drops one step and the fps goes back up. Edges stay
 * even; maxEdge must already be capped by the crop/source width, so the
 * sharable tier never upscales.
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

// AVIF sharable ladder: the three quality axes, in order - fps (anim ->
// 5/6 x anim), edge (the GIF ping-pong grid), then CRF (25 -> 36, the
// recipe's step of 4, clamped at 36). The whole fps/edge grid is tried
// at each CRF, top CRF first (AV1 spends its bits on detail, so a higher
// CRF at full resolution usually beats a lower CRF at a smaller frame).
const AVIF_CRF_STEPS = [25, 29, 33, 36];
const AVIF_EMERGENCY_CRF = 40;

export interface AvifRung {
  edge: number;
  fps: number;
  crf: number;
}

/**
 * AVIF sharable ladder, highest quality first: the fps/edge ping-pong
 * grid (same as GIF) at each CRF step, top CRF first. Edges stay even;
 * maxEdge must already be capped by the crop/source width (no upscale).
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
