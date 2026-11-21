export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parse a single HTTP Range header against a known size.
 * - no header: the full body (the caller serves it with a 200)
 * - "bytes=start-" / "bytes=start-end": an inclusive range within the
 *   file, with an end clamped to the last byte
 * - "bytes=-N": the suffix range - the LAST N bytes (start = size - N)
 * - anything else, or a start beyond the file: unsatisfiable (416)
 *
 * Only the first range is honored (multi-range requests are served the
 * first range, which is what a browser's <video> element sends in
 * practice).
 */
export function parseRangeHeader(
  header: string | null,
  size: number,
): { kind: "full" } | { kind: "range"; range: ByteRange } | { kind: "unsatisfiable" } {
  if (!header) return { kind: "full" };
  const m = /bytes=(\d*)-(\d*)/.exec(header);
  if (!m) return { kind: "unsatisfiable" };
  if (size <= 0) return { kind: "unsatisfiable" };
  // Suffix range: the last N bytes. A zero-length suffix is invalid.
  if (m[1] === "") {
    const n = Number(m[2]);
    if (!m[2] || !Number.isFinite(n) || n <= 0) return { kind: "unsatisfiable" };
    const start = Math.max(0, size - n);
    return { kind: "range", range: { start, end: size - 1 } };
  }
  const start = Number(m[1]);
  const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (!Number.isFinite(start) || start > end || start >= size) return { kind: "unsatisfiable" };
  return { kind: "range", range: { start, end } };
}
