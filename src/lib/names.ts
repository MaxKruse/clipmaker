const UNSAFE = /[\\/:*?"<>|]/g;
const MAX_NOTE_LEN = 64;

/** Strip path-unsafe characters, collapse whitespace, cap length. */
export function sanitizeNote(note: string): string {
  const cleaned = note
    .replace(UNSAFE, " ")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Code points, not units: a 64-unit cut can split an emoji in half.
  return [...cleaned].slice(0, MAX_NOTE_LEN).join("");
}

/**
 * Output filename per the clipmaker convention:
 * mp4: clip<N>[-<note>].mp4, gif: clip<N>[-<note>]-<longest-edge-px>.gif
 * (avif keeps the max edge, so it never carries an edge suffix).
 */
export function clipFileName(
  n: number,
  note: string | undefined,
  ext: "mp4" | "gif" | "avif",
  edgePx?: number,
): string {
  const t = sanitizeNote(note ?? "");
  const base = t ? `clip${n}-${t}` : `clip${n}`;
  return ext === "gif" && edgePx ? `${base}-${edgePx}.gif` : `${base}.${ext}`;
}

/**
 * Combined highlights file name: `<note>-highlights.mp4`. Named after the
 * group's note, never `clipN-...`, so it can never collide with the
 * individual part exports (which the combined export produces alongside).
 */
export function highlightsFileName(note: string): string {
  const t = sanitizeNote(note);
  return t ? `${t}-highlights.mp4` : "highlights.mp4";
}

/**
 * Part of a multi-part sharable highlights file:
 * `<note>-highlights-<n>.mp4`. A long combined file is split into
 * consecutive sharable parts, each its own file; the single-file name
 * (highlightsFileName) carries no part suffix, so the two never collide.
 */
export function highlightsPartFileName(note: string, n: number): string {
  const t = sanitizeNote(note);
  return `${t ? `${t}-highlights` : "highlights"}-${n}.mp4`;
}

/**
 * Content-disposition header for a download. RFC 6266: the plain
 * `filename=` gets an ASCII-only fallback (non-ASCII dropped, quotes and
 * backslashes removed, "download" when nothing is left), and the real
 * name goes into the `filename*=UTF-8''...` extension.
 */
export function disposition(name: string): string {
  let fallback = name
    .replace(/[^\x21-\x7E]/g, "")
    .replace(/["\\]/g, "")
    .trim();
  if (!fallback || fallback.startsWith(".")) fallback = "download";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
