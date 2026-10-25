const UNSAFE = /[\\/:*?"<>|]/g;
const MAX_NOTE_LEN = 64;

/** Strip path-unsafe characters, collapse whitespace, cap length. */
export function sanitizeNote(note: string): string {
  const cleaned = note
    .replace(UNSAFE, " ")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, MAX_NOTE_LEN);
}

/**
 * Output filename per the clipmaker convention:
 * mp4: clip<N>[-<note>].mp4, gif: clip<N>[-<note>]-<longest-edge-px>.gif
 */
export function clipFileName(
  n: number,
  note: string | undefined,
  ext: "mp4" | "gif",
  edgePx?: number,
): string {
  const t = sanitizeNote(note ?? "");
  const base = t ? `clip${n}-${t}` : `clip${n}`;
  return ext === "gif" && edgePx ? `${base}-${edgePx}.gif` : `${base}.${ext}`;
}
