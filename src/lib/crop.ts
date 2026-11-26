export interface CropBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Rotation of the crop about its center, in degrees. 0 = axis-aligned.
   * Positive = clockwise (matches CSS `transform: rotate`). The export
   * straightens the crop: the output is its content at 0°, sized w x h. */
  angle: number;
}

/** Smallest allowed crop in source pixels. */
export const MIN_CROP = 16;

/** Max crop rotation (degrees). Tilt-correction range; a full quarter-turn
 * is a transpose (a different feature). */
export const MAX_TILT_DEG = 45;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Round to the nearest even integer (yuv420p needs even dims/offsets). */
const even = (n: number) => Math.round(n) - (Math.round(n) & 1);
/** Smallest even integer >= n. */
const evenCeil = (n: number) => {
  let r = Math.ceil(n);
  if (r & 1) r++;
  return r;
};

/**
 * Even crop origin nearest `t` that keeps both the crop (cw wide, inside a
 * `src` px frame) and its evened bbox (fw wide, centered on the crop) in
 * frame. A solution exists when the caller's fit checks passed (the parity
 * conflict is shrunk away before this is called).
 */
const placeEven = (t: number, cw: number, fw: number, src: number): number => {
  let p = Math.round(t);
  const lo = Math.max(0, (fw - cw) / 2);
  const hi = Math.min(src - cw, src - (fw + cw) / 2);
  if (p < lo) p = lo;
  if (p > hi) p = hi;
  if (p & 1) p += p < hi ? 1 : -1;
  return p;
};

/** Rotation about the crop center, clamped to +/-MAX_TILT_DEG, rounded to 0.1°. */
export function clampAngle(a: number): number {
  if (!Number.isFinite(a)) return 0;
  return Math.round(clamp(a, -MAX_TILT_DEG, MAX_TILT_DEG) * 10) / 10;
}

/** The crop's center in source px. */
export function cropCenter(c: CropBox): { x: number; y: number } {
  return { x: c.x + c.w / 2, y: c.y + c.h / 2 };
}

/** Axis-aligned bounding box of the (possibly tilted) crop, in source px.
 * All fields even; this is the region ffmpeg crops first, then un-tilts.
 * Expects an already-normalized crop (its bbox fits the frame). */
export function cropBBox(c: CropBox): { x: number; y: number; w: number; h: number } {
  const a = (Math.abs(c.angle) * Math.PI) / 180;
  const co = Math.cos(a);
  const si = Math.sin(a);
  const w = evenCeil(c.w * co + c.h * si);
  const h = evenCeil(c.w * si + c.h * co);
  const { x, y } = cropCenter(c);
  return { x: even(x - w / 2), y: even(y - h / 2), w, h };
}

/**
 * Clamp a crop to the frame, enforce the minimum size, round to even
 * x/y/w/h (so yuv420p output stays valid), and - when the crop is tilted -
 * shrink/re-center it so its EVENED bounding box stays inside the frame
 * (the filter chain crops the evened box, so that is the size that must
 * fit). A frame too small to hold the 16px minimum at the tilt gets a
 * sub-minimum even crop instead of an encode that cannot run.
 */
export function normalizeCrop(srcW: number, srcH: number, c: CropBox): CropBox {
  const angle = clampAngle(c.angle);
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
  if (angle !== 0) {
    const a = (Math.abs(angle) * Math.PI) / 180;
    const co = Math.cos(a);
    const si = Math.sin(a);
    // The filter chain crops the EVENED bbox, so it is the evened size that
    // must fit the frame: the raw size can sit 1px under the frame while its
    // even ceiling is 2px over (odd-sized sources).
    const fit = (cw: number, ch: number) => ({
      w: evenCeil(cw * co + ch * si),
      h: evenCeil(cw * si + ch * co),
    });
    let f = fit(w, h);
    if (f.w > srcW || f.h > srcH) {
      // A thin, wide crop at a large angle: shrink so the evened bbox fits.
      const k = Math.min(srcW / f.w, srcH / f.h);
      w = even(Math.max(MIN_CROP, Math.floor(w * k)));
      h = even(Math.max(MIN_CROP, Math.floor(h * k)));
      f = fit(w, h);
      // The 16px floor can still overflow a tiny frame (a 16px crop at 45
      // deg needs 24px): there a sub-minimum even crop is the lesser evil -
      // an export that runs beats a minimum size that cannot fit.
      if (f.w > srcW || f.h > srcH) {
        const k2 = Math.min(srcW / f.w, srcH / f.h);
        w = even(Math.max(2, Math.floor(w * k2)));
        h = even(Math.max(2, Math.floor(h * k2)));
        f = fit(w, h);
      }
    }
    // A zero-slack fit pins the crop center to one half-step parity; when
    // that pinned parity is odd, no even x (or y) can hold the bbox in
    // frame, so give the pinned axis 2px of slack.
    if (srcW - f.w === 0 && ((f.w - w) / 2) % 2 !== 0) {
      const k = (srcW - 2) / f.w;
      w = even(Math.max(2, Math.floor(w * k)));
      f = fit(w, h);
    }
    if (srcH - f.h === 0 && ((f.h - h) / 2) % 2 !== 0) {
      const k = (srcH - 2) / f.h;
      h = even(Math.max(2, Math.floor(h * k)));
      f = fit(w, h);
    }
    // Center the crop on the clamped target while the evened bbox stays in
    // frame and x/y stay even (the fit checks above make an even placement
    // exist on both axes).
    const cx = clamp(x + w / 2, f.w / 2, srcW - f.w / 2);
    const cy = clamp(y + h / 2, f.h / 2, srcH - f.h / 2);
    x = placeEven(cx - w / 2, w, f.w, srcW);
    y = placeEven(cy - h / 2, h, f.h, srcH);
  }
  return { x, y, w, h, angle };
}

/**
 * The crop as an ffmpeg `-vf` fragment, or "" for the full frame.
 * Axis-aligned: a plain `crop=w:h:x:y`. Tilted: crop the axis-aligned
 * bounding box, un-tilt it about the crop center (the bbox center), then
 * crop the straightened w x h out of the center - so the output is the crop
 * content at 0°, sized w x h, with no black corners.
 */
export function cropFilter(c: CropBox | null): string {
  if (!c) return "";
  if (c.angle === 0) return `crop=${c.w}:${c.h}:${c.x}:${c.y}`;
  const bb = cropBBox(c);
  const ow = evenCeil(Math.max(bb.w, c.w));
  const oh = evenCeil(Math.max(bb.h, c.h));
  const a = -((c.angle * Math.PI) / 180); // un-tilt (negative of the crop's tilt)
  const cx = even((ow - c.w) / 2);
  const cy = even((oh - c.h) / 2);
  return (
    `crop=${bb.w}:${bb.h}:${bb.x}:${bb.y},` +
    `rotate=${Number(a.toFixed(6))}:c=black:ow=${ow}:oh=${oh},` +
    `crop=${c.w}:${c.h}:${cx}:${cy}`
  );
}
