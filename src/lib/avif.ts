/** AVIF encode-time warning for long clips: the AV1 encode is slow, so a
 * clip over 45s warns (yellow) and one over 60s is flagged (red). */
export type AvifDurationLevel = "none" | "warn" | "danger";

export function avifDurationLevel(seconds: number): AvifDurationLevel {
  if (seconds > 60) return "danger";
  if (seconds > 45) return "warn";
  return "none";
}
