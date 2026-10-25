export interface CropBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Smallest allowed crop in source pixels. */
export const MIN_CROP = 16;

/**
 * Clamp a crop box to the frame, enforce the minimum size and round to
 * even x/y/w/h so yuv420p output stays valid.
 */
export function normalizeCrop(srcW: number, srcH: number, c: CropBox): CropBox {
  let w = Math.max(MIN_CROP, Math.min(Math.round(c.w), srcW));
  let h = Math.max(MIN_CROP, Math.min(Math.round(c.h), srcH));
  let x = Math.max(0, Math.min(Math.round(c.x), srcW - w));
  let y = Math.max(0, Math.min(Math.round(c.y), srcH - h));
  w -= w & 1;
  h -= h & 1;
  x -= x & 1;
  y -= y & 1;
  if (x + w > srcW) x = srcW - w;
  if (y + h > srcH) y = srcH - h;
  return { x, y, w, h };
}

/** ffmpeg crop filter fragment, or "" for full frame. */
export function cropFilter(c: CropBox | null): string {
  return c ? `crop=${c.w}:${c.h}:${c.x}:${c.y}` : "";
}
