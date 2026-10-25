/** Round to 50k units with a 500k floor (skill recipe). */
export function round50k(kbit: number): number {
  return Math.max(500, Math.round(kbit / 50) * 50);
}

/**
 * Target mp4 video bitrate: source bitrate scaled for the fps change,
 * rounded to 50k units, floored at 500k.
 */
export function targetVideoKbit(srcKbit: number, srcFps: number, outFps: number): number {
  return round50k((srcKbit * outFps) / srcFps);
}

/**
 * Resolve the effective source video bitrate:
 * stream bit_rate first, else format bit_rate minus audio bit_rate, else 6000k.
 */
export function resolveSourceKbit(v: {
  videoKbit: number | null;
  formatKbit: number | null;
  audioKbit: number | null;
}): number {
  if (v.videoKbit && v.videoKbit > 0) return v.videoKbit;
  if (v.formatKbit) {
    const k = v.formatKbit - (v.audioKbit ?? 0);
    if (k > 0) return k;
  }
  return 6000;
}
