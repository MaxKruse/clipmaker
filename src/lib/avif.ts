/** AVIF encode-time warning for long clips: the AV1 encode is slow, so a
 * clip over 45s warns (yellow) and one over 60s is flagged (red). */
export type AvifDurationLevel = "none" | "warn" | "danger";

export function avifDurationLevel(seconds: number): AvifDurationLevel {
  if (seconds > 60) return "danger";
  if (seconds > 45) return "warn";
  return "none";
}

/** The user-facing sentence for a non-"none" avifDurationLevel - the single
 * wording shared by the options panel and the clip-queue tooltip. */
export function avifWarningText(level: "warn" | "danger", seconds: number): string {
  const s = Math.round(seconds);
  return level === "danger"
    ? `AVIF: a ${s}s clip - the AV1 encode will take a long time`
    : `AVIF: a ${s}s clip - expect a slow AV1 encode`;
}
