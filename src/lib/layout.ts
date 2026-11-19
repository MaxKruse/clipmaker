// Resizable work-area layout: the right column's width plus the heights
// of the three user-resizable panels (stage, filmstrip, options). A null
// height means "natural content height"; the page measures the panel
// when a seam drag starts, then clamps every value to LAYOUT_LIMITS.
// The pure load/save helpers here keep storage access (localStorage) in
// the page; the tests exercise them with injected read/write functions.

export interface WorkLayout {
  /** Right column (options + clip queue) width in px. */
  right: number;
  /** Stage (player) panel height in px; null = natural. */
  stage: number | null;
  /** Filmstrip panel height in px; null = natural. */
  strip: number | null;
  /** Options panel height in px; null = natural. */
  options: number | null;
}

export const defaultLayout: WorkLayout = {
  right: 400,
  stage: null,
  strip: null,
  options: null,
};

/** Inclusive [min, max] for each field, in px. */
export const LAYOUT_LIMITS = {
  right: [280, 800],
  stage: [140, 1200],
  strip: [72, 320],
  options: [96, 900],
} as const;

export type SeamKey = "right" | "stage" | "strip" | "options";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Clamp every field into its limits (null heights stay null). */
export function clampLayout(l: WorkLayout): WorkLayout {
  return {
    right: clamp(l.right, LAYOUT_LIMITS.right[0], LAYOUT_LIMITS.right[1]),
    stage: l.stage == null ? null : clamp(l.stage, LAYOUT_LIMITS.stage[0], LAYOUT_LIMITS.stage[1]),
    strip: l.strip == null ? null : clamp(l.strip, LAYOUT_LIMITS.strip[0], LAYOUT_LIMITS.strip[1]),
    options: l.options == null ? null : clamp(l.options, LAYOUT_LIMITS.options[0], LAYOUT_LIMITS.options[1]),
  };
}

/** Read and validate a persisted layout. Missing, corrupt, or malformed
 * values fall back to the defaults, so stale or damaged storage
 * self-heals instead of breaking the page. */
export function loadLayout(read: () => string | null): WorkLayout {
  try {
    const raw = read();
    if (!raw) return { ...defaultLayout };
    const j = JSON.parse(raw) as Record<string, unknown> | null;
    const out: WorkLayout = { ...defaultLayout };
    if (j) {
      for (const key of ["right", "stage", "strip", "options"] as const) {
        const v = j[key];
        if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
      }
    }
    return clampLayout(out);
  } catch {
    return { ...defaultLayout };
  }
}

/** Serialize a clamped layout; a failing write (storage full/blocked)
 * is swallowed - the layout simply does not persist. */
export function saveLayout(write: (s: string) => void, l: WorkLayout): void {
  try {
    write(JSON.stringify(clampLayout(l)));
  } catch {
    // not persisted
  }
}
