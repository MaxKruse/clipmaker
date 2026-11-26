import { describe, expect, test } from "bun:test";
import { MAX_TILT_DEG, clampAngle, cropBBox, cropCenter, cropFilter, normalizeCrop } from "../src/lib/crop";

describe("normalizeCrop", () => {
  test("keeps a valid in-bounds box untouched", () => {
    expect(normalizeCrop(1920, 1080, { x: 100, y: 200, w: 640, h: 360, angle: 0 })).toEqual({
      x: 100,
      y: 200,
      w: 640,
      h: 360,
      angle: 0,
    });
  });

  test("full frame passes through", () => {
    expect(normalizeCrop(1920, 1080, { x: 0, y: 0, w: 1920, h: 1080, angle: 0 })).toEqual({
      x: 0,
      y: 0,
      w: 1920,
      h: 1080,
      angle: 0,
    });
  });

  test("clamps oversized box to frame", () => {
    expect(normalizeCrop(1920, 1080, { x: -100, y: -100, w: 5000, h: 5000, angle: 0 })).toEqual({
      x: 0,
      y: 0,
      w: 1920,
      h: 1080,
      angle: 0,
    });
  });

  test("shifts box that overflows the right/bottom edge", () => {
    expect(normalizeCrop(1920, 1080, { x: 1900, y: 1000, w: 100, h: 100, angle: 0 })).toEqual({
      x: 1820,
      y: 980,
      w: 100,
      h: 100,
      angle: 0,
    });
  });

  test("enforces the 16px minimum size", () => {
    expect(normalizeCrop(1920, 1080, { x: 0, y: 0, w: 4, h: 4, angle: 0 })).toEqual({
      x: 0,
      y: 0,
      w: 16,
      h: 16,
      angle: 0,
    });
  });

  test("rounds to even x/y/w/h (yuv420p friendly)", () => {
    expect(normalizeCrop(1920, 1080, { x: 3, y: 5, w: 101, h: 51, angle: 0 })).toEqual({
      x: 2,
      y: 4,
      w: 100,
      h: 50,
      angle: 0,
    });
  });

  test("a centered tilted crop stays put", () => {
    expect(normalizeCrop(1920, 1080, { x: 460, y: 180, w: 1000, h: 540, angle: 5 })).toEqual({
      x: 460,
      y: 180,
      w: 1000,
      h: 540,
      angle: 5,
    });
  });

  test("a tilted crop pushed to the edge is re-centered so its bbox fits", () => {
    expect(normalizeCrop(1920, 1080, { x: 1500, y: 0, w: 1000, h: 540, angle: 30 })).toEqual({
      x: 850,
      y: 214,
      w: 1000,
      h: 540,
      angle: 30,
    });
  });

  test("missing angle defaults to 0", () => {
    const c = normalizeCrop(1920, 1080, { x: 100, y: 100, w: 200, h: 200 } as never);
    expect(c.angle).toBe(0);
  });

  test("a tilted crop's bbox fits the frame on odd-sized sources", () => {
    // The evened bbox is up to 2px wider than the raw one; on an odd-sized
    // frame a raw fit does not imply an evened fit. The fit check must use
    // the evened size, otherwise the first ffmpeg crop overflows the frame
    // ("Invalid too big or non positive size") and the export fails.
    const cases: [number, number, { x: number; y: number; w: number; h: number; angle: number }][] = [
      [99, 99, { x: 0, y: 0, w: 99, h: 99, angle: 45 }],
      [1081, 1921, { x: 0, y: 0, w: 1081, h: 1081, angle: 45 }],
      [33, 65, { x: 0, y: 0, w: 33, h: 65, angle: 45 }],
      [22, 22, { x: 0, y: 0, w: 22, h: 22, angle: 45 }],
      [20, 20, { x: 0, y: 0, w: 20, h: 20, angle: 45 }],
      [30, 20, { x: 0, y: 0, w: 30, h: 20, angle: 45 }],
    ];
    for (const [W, H, c] of cases) {
      const n = normalizeCrop(W, H, c);
      const bb = cropBBox(n);
      const ctx = `bbox of ${W}x${H} for a ${n.w}x${n.h}@${n.angle} crop`;
      expect(bb.x, ctx).toBeGreaterThanOrEqual(0);
      expect(bb.y, ctx).toBeGreaterThanOrEqual(0);
      expect(bb.x + bb.w, ctx).toBeLessThanOrEqual(W);
      expect(bb.y + bb.h, ctx).toBeLessThanOrEqual(H);
    }
  });

  test("cropFilter's first crop stage is always a valid crop of the frame", () => {
    // ffmpeg rejects a first stage whose w/h exceed the input or whose
    // x/y go negative, failing the whole encode; every angle the UI can
    // produce must survive normalization into a valid chain.
    const cases: [number, number, number, number][] = [
      [99, 99, 0, 99],
      [1081, 1921, 0, 1081],
      [33, 65, 0, 65],
      [22, 22, 0, 22],
      [30, 20, 0, 20],
      [1920, 1080, 1700, 300],
    ];
    for (const [W, H, x0, size] of cases) {
      for (const angle of [5, -12, 30, -45, 45]) {
        const n = normalizeCrop(W, H, { x: x0, y: 0, w: size, h: size, angle });
        const f = cropFilter(n);
        const m = f.split(",")[0].match(/^crop=(\d+):(\d+):(-?\d+):(-?\d+)$/);
        expect(m, `first stage of ${f} for ${W}x${H} @${angle}`).not.toBeNull();
        const [, w, h, x, y] = m!;
        const ctx = `${W}x${H} @${angle}: ${f}`;
        expect(Number(w), ctx).toBeLessThanOrEqual(W);
        expect(Number(h), ctx).toBeLessThanOrEqual(H);
        expect(Number(x), ctx).toBeGreaterThanOrEqual(0);
        expect(Number(y), ctx).toBeGreaterThanOrEqual(0);
        expect(Number(x) + Number(w), ctx).toBeLessThanOrEqual(W);
        expect(Number(y) + Number(h), ctx).toBeLessThanOrEqual(H);
      }
    }
  });
});

describe("clampAngle", () => {
  test("rounds to 0.1 deg", () => {
    expect(clampAngle(12.345)).toBe(12.3);
    expect(clampAngle(-3.004)).toBe(-3);
  });

  test("clamps to the tilt range", () => {
    expect(clampAngle(90)).toBe(MAX_TILT_DEG);
    expect(clampAngle(-90)).toBe(-MAX_TILT_DEG);
  });

  test("non-finite falls back to 0", () => {
    expect(clampAngle(NaN)).toBe(0);
    expect(clampAngle(Infinity)).toBe(0);
  });
});

describe("cropCenter", () => {
  test("midpoint of the base box", () => {
    expect(cropCenter({ x: 460, y: 180, w: 1000, h: 540, angle: 0 })).toEqual({ x: 960, y: 450 });
  });
});

describe("cropBBox", () => {
  test("axis-aligned crop has a zero-inflated bbox", () => {
    expect(cropBBox({ x: 100, y: 200, w: 640, h: 360, angle: 0 })).toEqual({ x: 100, y: 200, w: 640, h: 360 });
  });

  test("tilted crop bbox is larger and centered on the crop", () => {
    expect(cropBBox({ x: 460, y: 180, w: 1000, h: 540, angle: 5 })).toEqual({ x: 438, y: 136, w: 1044, h: 626 });
  });

  test("bbox is symmetric in the sign of the angle", () => {
    expect(cropBBox({ x: 100, y: 100, w: 500, h: 300, angle: 20 })).toEqual(
      cropBBox({ x: 100, y: 100, w: 500, h: 300, angle: -20 }),
    );
  });
});

describe("cropFilter", () => {
  test("null crop -> empty filter", () => {
    expect(cropFilter(null)).toBe("");
  });

  test("axis-aligned crop -> plain crop=w:h:x:y", () => {
    expect(cropFilter({ x: 2, y: 4, w: 100, h: 50, angle: 0 })).toBe("crop=100:50:2:4");
  });

  test("tilted crop -> bbox crop, un-tilt about center, center crop", () => {
    const parts = cropFilter({ x: 460, y: 180, w: 1000, h: 540, angle: 5 }).split(",");
    expect(parts[0]).toBe("crop=1044:626:438:136");
    expect(parts[1].startsWith("rotate=-0.08726")).toBe(true);
    expect(parts[1]).toContain(":c=black:ow=1044:oh=626");
    expect(parts[2]).toBe("crop=1000:540:22:42");
  });

  test("tilted crop un-tilts with the opposite sign of the stored angle", () => {
    const parts = cropFilter({ x: 460, y: 180, w: 1000, h: 540, angle: -5 }).split(",");
    expect(parts[1].startsWith("rotate=0.08726")).toBe(true);
  });
});
