export interface Rung {
  edge: number;
  fps: number;
}

// Quality ladder ratios (skill recipe, 1024px baseline):
// 1024@30, 1024@25, 768@25, 640@25, 512@25, 384@25, 256@25
const RATIOS: { r: number; fps: number }[] = [
  { r: 1, fps: 30 },
  { r: 1, fps: 25 },
  { r: 0.75, fps: 25 },
  { r: 0.625, fps: 25 },
  { r: 0.5, fps: 25 },
  { r: 0.375, fps: 25 },
  { r: 0.25, fps: 25 },
];
const EMERGENCY_RATIO = 0.1875; // 192px at the 1024 baseline

export function evenFloor(x: number): number {
  return Math.max(2, Math.floor(x / 2) * 2);
}

/** Scale the quality ladder to the chosen max edge; edges stay even. */
export function buildLadder(maxEdge: number): Rung[] {
  return RATIOS.map(({ r, fps }) => ({ edge: evenFloor(maxEdge * r), fps }));
}

/** Last-resort rung tried when every ladder rung exceeds the size cap. */
export function emergencyRung(maxEdge: number): Rung {
  return { edge: evenFloor(maxEdge * EMERGENCY_RATIO), fps: 25 };
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
