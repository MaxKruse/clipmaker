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

// AVIF (animated AV1) keeps the max-edge resolution and steps the AV1
// CRF down instead of the pixel size: at equal byte budgets AV1 spends
// its bits on detail, not on a smaller frame.
const AVIF_CRF_STEPS = [30, 34, 38, 42, 46, 50];
const AVIF_EMERGENCY_CRF = 54;

/** AVIF crf ladder, best quality first (higher crf = smaller file). */
export function buildAvifCrfLadder(): number[] {
  return [...AVIF_CRF_STEPS];
}

/** Last-resort crf tried when every ladder rung exceeds the size cap. */
export function avifEmergencyCrf(): number {
  return AVIF_EMERGENCY_CRF;
}

/**
 * Index of the first rung whose measured size fits under maxMB,
 * or -1 when nothing fits. null entries are skipped (failed rung).
 */
export function pickRungIndex(sizesMB: (number | null)[], maxMB: number): number {
  for (let i = 0; i < sizesMB.length; i++) {
    const s = sizesMB[i];
    if (s !== null && s <= maxMB) return i;
  }
  return -1;
}
