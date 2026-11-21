import { describe, expect, test } from "bun:test";
import { parseRangeHeader } from "../src/lib/range";

// The video file route streams bytes; a Range request must be parsed
// exactly per RFC 7233 so a <video> element (and curl) get the bytes
// it asked for. Suffix ranges ("bytes=-N" = the LAST N bytes) are the
// classic misparse: they must start at size - N, not at 0.

describe("parseRangeHeader", () => {
  test("no header serves the full body", () => {
    expect(parseRangeHeader(null, 1000)).toEqual({ kind: "full" });
  });

  test("start-end range", () => {
    expect(parseRangeHeader("bytes=100-199", 1000)).toEqual({
      kind: "range",
      range: { start: 100, end: 199 },
    });
  });

  test("open-ended range runs to the last byte", () => {
    expect(parseRangeHeader("bytes=100-", 1000)).toEqual({
      kind: "range",
      range: { start: 100, end: 999 },
    });
  });

  test("end beyond the size is clamped", () => {
    expect(parseRangeHeader("bytes=0-9999", 1000)).toEqual({
      kind: "range",
      range: { start: 0, end: 999 },
    });
  });

  test("suffix range serves the LAST N bytes", () => {
    expect(parseRangeHeader("bytes=-500", 1000)).toEqual({
      kind: "range",
      range: { start: 500, end: 999 },
    });
  });

  test("suffix range larger than the file serves everything", () => {
    expect(parseRangeHeader("bytes=-9999", 1000)).toEqual({
      kind: "range",
      range: { start: 0, end: 999 },
    });
  });

  test("zero-length suffix range is unsatisfiable", () => {
    expect(parseRangeHeader("bytes=-0", 1000)).toEqual({ kind: "unsatisfiable" });
  });

  test("start beyond the size is unsatisfiable", () => {
    expect(parseRangeHeader("bytes=1000-", 1000)).toEqual({ kind: "unsatisfiable" });
  });

  test("reversed range is unsatisfiable", () => {
    expect(parseRangeHeader("bytes=500-200", 1000)).toEqual({ kind: "unsatisfiable" });
  });

  test("malformed header is unsatisfiable", () => {
    expect(parseRangeHeader("banana", 1000)).toEqual({ kind: "unsatisfiable" });
  });

  test("empty file is unsatisfiable", () => {
    expect(parseRangeHeader("bytes=0-100", 0)).toEqual({ kind: "unsatisfiable" });
  });
});
