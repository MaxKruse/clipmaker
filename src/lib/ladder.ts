export interface Rung {
  edge: number;
  fps: number;
}

// Quality ladder ratios (skill recipe, 1024px baseline @ 30fps):
// 1024@30, 1024@25, 768@25, 640@25, 512@25, 384@25, 256@25.
// The fps step after the first rung is 5/6 of the chosen anim fps
// (the recipe's 30 -> 25), so at 30fps the ladder is exactly the recipe.
const FPS_STEP = 5 / 6;
const RATIOS: { r: number; f: number }[] = [
  { r: 1, f: 1 },
  { r: 1, f: FPS_STEP },
  { r: 0.75, f: FPS_STEP },
  { r: 0.625, f: FPS_STEP },
  { r: 0.5, f: FPS_STEP },
  { r: 0.375, f: FPS_STEP },
  { r: 0.25, f: FPS_STEP },
];
const EMERGENCY_RATIO = 0.1875; // 192px at the 1024 baseline

export function evenFloor(x: number): number {
  return Math.max(2, Math.floor(x / 2) * 2);
}

/** Scale the quality ladder to the chosen max edge and anim fps; edges stay even. */
export function buildLadder(maxEdge: number, fps: number): Rung[] {
  return RATIOS.map(({ r, f }) => ({
    edge: evenFloor(maxEdge * r),
    // The reduced rungs drop to 5/6 of the anim fps (the recipe's 30 -> 25).
    fps: f === 1 ? fps : Math.max(1, Math.round(fps * FPS_STEP)),
  }));
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
