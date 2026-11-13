import { describe, expect, test } from "bun:test";
import { clipFileName, sanitizeNote } from "../src/lib/names";

describe("clipFileName", () => {
  test("mp4 without note", () => {
    expect(clipFileName(1, "", "mp4")).toBe("clip1.mp4");
    expect(clipFileName(1, undefined, "mp4")).toBe("clip1.mp4");
  });

  test("mp4 with note", () => {
    expect(clipFileName(2, "Cuteness Overload", "mp4")).toBe("clip2-Cuteness Overload.mp4");
  });

  test("gif appends longest edge", () => {
    expect(clipFileName(4, "Cute", "gif", 640)).toBe("clip4-Cute-640.gif");
    expect(clipFileName(3, undefined, "gif", 512)).toBe("clip3-512.gif");
  });

  test("avif never appends an edge (it keeps the max edge)", () => {
    expect(clipFileName(4, "Cute", "avif")).toBe("clip4-Cute.avif");
    expect(clipFileName(3, undefined, "avif")).toBe("clip3.avif");
    expect(clipFileName(3, undefined, "avif", 1024)).toBe("clip3.avif");
  });

  test("note never starts/ends with dash", () => {
    expect(clipFileName(1, "  ", "mp4")).toBe("clip1.mp4");
  });
});

describe("sanitizeNote", () => {
  test("replaces path-unsafe characters with spaces and collapses", () => {
    expect(sanitizeNote('a/b\\c:d*e?f"g<h>i|j')).toBe("a b c d e f g h i j");
  });

  test("trims and collapses whitespace", () => {
    expect(sanitizeNote("  spaced   out\t\n  ")).toBe("spaced out");
  });

  test("empty note stays empty", () => {
    expect(sanitizeNote("")).toBe("");
    expect(sanitizeNote("///")).toBe("");
  });

  test("caps length at 64 chars", () => {
    const long = "x".repeat(200);
    expect(sanitizeNote(long).length).toBe(64);
  });

  test("keeps unicode", () => {
    expect(sanitizeNote("Ünïcödé-Clïp")).toBe("Ünïcödé-Clïp");
  });
});

describe("sanitizeNote code points", () => {
  test("a truncation never splits an emoji into a lone surrogate", () => {
    const emoji = "🎉"; // 2 code units, 1 code point
    const out = sanitizeNote(emoji.repeat(65)); // 130 units, 65 points
    expect(out).toBe(emoji.repeat(64));
    expect(out.length).toBe(128);
  });
});
