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

/** 32-bit FNV-1a of s as 8 hex digits - deterministic, no imports. */
const fnv1a = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
};

/**
 * Base name of a group's compilation files, after the group's note and
 * sanitized like clip names. When sanitizing changed the note (unsafe
 * characters, whitespace, truncation) a `-x<hash>` of the RAW note is
 * appended: two different notes that sanitize alike ("a/b" and "a b")
 * must never share a file. The base is a pure function of the note, so
 * re-exporting a subset of the same group lands on the same name.
 */
export function combinedBase(note: string): string {
  const t = sanitizeNote(note);
  if (!t) return "";
  return note === t ? t : `${t}-x${fnv1a(note)}`;
}

/**
 * The combined compilation file name: `<note>-combined.mp4`. Named after
 * the group's note, never `clipN-...`, so it can never collide with the
 * individual part exports (which the combined export produces alongside).
 * Lives in `Compilations/` in the export dir.
 */
export function combinedFileName(note: string): string {
  const b = combinedBase(note);
  return b ? `${b}-combined.mp4` : "combined.mp4";
}

/**
 * The compilation preview file name: `<note>-Preview.mp4` - the short
 * middle-sections version of the combined file, in `Compilations/Preview/`.
 */
export function previewFileName(note: string): string {
  const b = combinedBase(note);
  return b ? `${b}-Preview.mp4` : "Preview.mp4";
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
