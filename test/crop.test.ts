import { describe, expect, test } from "bun:test";
import { cropFilter, normalizeCrop } from "../src/lib/crop";

describe("normalizeCrop", () => {
  test("keeps a valid in-bounds box untouched", () => {
    expect(normalizeCrop(1920, 1080, { x: 100, y: 200, w: 640, h: 360 })).toEqual({
      x: 100,
      y: 200,
      w: 640,
      h: 360,
    });
  });

  test("full frame passes through", () => {
    expect(normalizeCrop(1920, 1080, { x: 0, y: 0, w: 1920, h: 1080 })).toEqual({
      x: 0,
      y: 0,
      w: 1920,
      h: 1080,
    });
  });

  test("clamps oversized box to frame", () => {
    expect(normalizeCrop(1920, 1080, { x: -100, y: -100, w: 5000, h: 5000 })).toEqual({
      x: 0,
      y: 0,
      w: 1920,
      h: 1080,
    });
  });

  test("shifts box that overflows the right/bottom edge", () => {
    expect(normalizeCrop(1920, 1080, { x: 1900, y: 1000, w: 100, h: 100 })).toEqual({
      x: 1820,
      y: 980,
      w: 100,
      h: 100,
    });
  });

  test("enforces the 16px minimum size", () => {
    expect(normalizeCrop(1920, 1080, { x: 0, y: 0, w: 4, h: 4 })).toEqual({
      x: 0,
      y: 0,
      w: 16,
      h: 16,
    });
  });

  test("rounds to even x/y/w/h (yuv420p friendly)", () => {
    expect(normalizeCrop(1920, 1080, { x: 3, y: 5, w: 101, h: 51 })).toEqual({
      x: 2,
      y: 4,
      w: 100,
      h: 50,
    });
  });
});

describe("cropFilter", () => {
  test("null crop -> empty filter", () => {
    expect(cropFilter(null)).toBe("");
  });

  test("builds crop=w:h:x:y", () => {
    expect(cropFilter({ x: 2, y: 4, w: 100, h: 50 })).toBe("crop=100:50:2:4");
  });
});
