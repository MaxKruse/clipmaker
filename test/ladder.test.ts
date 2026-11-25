import { describe, expect, test } from "bun:test";
import {
  avifEmergencyRung,
  buildAvifLadder,
  buildLadder,
  emergencyRung,
  sharableCap,
} from "../src/lib/ladder";

describe("sharableCap", () => {
  test("landscape frame: cap is min(maxEdge, width), axis w", () => {
    expect(sharableCap(1000, 1920, 1080)).toEqual({ cap: 1000, axis: "w" });
  });

  test("narrower crop than maxEdge: keeps the crop's longest edge (no upscale)", () => {
    expect(sharableCap(1440, 1008, 568)).toEqual({ cap: 1008, axis: "w" });
  });

  test("portrait crop: cap targets the HEIGHT, so h stays under maxEdge", () => {
    expect(sharableCap(1000, 1000, 1008)).toEqual({ cap: 1000, axis: "h" });
  });

  test("portrait crop shorter than maxEdge: keeps what it has, axis h", () => {
    expect(sharableCap(1000, 700, 900)).toEqual({ cap: 900, axis: "h" });
  });

  test("square frame: axis w", () => {
    expect(sharableCap(1000, 900, 900)).toEqual({ cap: 900, axis: "w" });
  });
});

describe("buildLadder", () => {
  test("ping-pong: fps first (anim -> 5/6), then edge one step down at anim fps", () => {
    expect(buildLadder(1024, 30)).toEqual([
      { edge: 1024, fps: 30 },
      { edge: 1024, fps: 25 },
      { edge: 768, fps: 30 },
      { edge: 768, fps: 25 },
      { edge: 640, fps: 30 },
      { edge: 640, fps: 25 },
      { edge: 512, fps: 30 },
      { edge: 512, fps: 25 },
      { edge: 384, fps: 30 },
      { edge: 384, fps: 25 },
      { edge: 256, fps: 30 },
      { edge: 256, fps: 25 },
    ]);
  });

  test("640px base scales the same ratios", () => {
    expect(buildLadder(640, 30)).toEqual([
      { edge: 640, fps: 30 },
      { edge: 640, fps: 25 },
      { edge: 480, fps: 30 },
      { edge: 480, fps: 25 },
      { edge: 400, fps: 30 },
      { edge: 400, fps: 25 },
      { edge: 320, fps: 30 },
      { edge: 320, fps: 25 },
      { edge: 240, fps: 30 },
      { edge: 240, fps: 25 },
      { edge: 160, fps: 30 },
      { edge: 160, fps: 25 },
    ]);
  });

  test("fps steps scale with the anim fps", () => {
    expect(buildLadder(1024, 60)).toEqual([
      { edge: 1024, fps: 60 },
      { edge: 1024, fps: 50 },
      { edge: 768, fps: 60 },
      { edge: 768, fps: 50 },
      { edge: 640, fps: 60 },
      { edge: 640, fps: 50 },
      { edge: 512, fps: 60 },
      { edge: 512, fps: 50 },
      { edge: 384, fps: 60 },
      { edge: 384, fps: 50 },
      { edge: 256, fps: 60 },
      { edge: 256, fps: 50 },
    ]);
    expect(buildLadder(640, 25)).toEqual([
      { edge: 640, fps: 25 },
      { edge: 640, fps: 21 },
      { edge: 480, fps: 25 },
      { edge: 480, fps: 21 },
      { edge: 400, fps: 25 },
      { edge: 400, fps: 21 },
      { edge: 320, fps: 25 },
      { edge: 320, fps: 21 },
      { edge: 240, fps: 25 },
      { edge: 240, fps: 21 },
      { edge: 160, fps: 25 },
      { edge: 160, fps: 21 },
    ]);
  });

  test("edges are always even and fps stays >= 1", () => {
    for (const maxEdge of [1024, 1280, 1440, 768, 512, 256]) {
      for (const fps of [15, 20, 25, 30, 60]) {
        for (const rung of buildLadder(maxEdge, fps)) {
          expect(rung.edge % 2).toBe(0);
          expect(rung.edge).toBeGreaterThan(0);
          expect(rung.fps).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  test("small bases collapse duplicate edges: no rung is encoded twice", () => {
    for (const base of [10, 20, 40]) {
      const ladder = buildLadder(base, 30);
      const keys = new Set(ladder.map((r) => `${r.edge}@${r.fps}`));
      expect(keys.size).toBe(ladder.length);
      // quality order preserved: edges never increase while descending
      for (let i = 1; i < ladder.length; i++) {
        expect(ladder[i].edge).toBeLessThanOrEqual(ladder[i - 1].edge);
      }
    }
  });
});

describe("emergencyRung", () => {
  test("192@25 for 1024px @ 30fps", () => {
    expect(emergencyRung(1024, 30)).toEqual({ edge: 192, fps: 25 });
  });

  test("fps scales with the anim fps", () => {
    expect(emergencyRung(1024, 60)).toEqual({ edge: 192, fps: 50 });
    expect(emergencyRung(640, 25)).toEqual({ edge: 120, fps: 21 });
  });

  test("scales with the max edge", () => {
    expect(emergencyRung(1440, 30)).toEqual({ edge: 270, fps: 25 });
  });
});

describe("AVIF sharable ladder", () => {
  test("CRF is the outer axis (25, 29, 33, 36); the fps/edge ping-pong grid is inner", () => {
    const grid = buildLadder(1024, 30);
    const ladder = buildAvifLadder(1024, 30);
    expect(ladder.length).toBe(grid.length * 4);
    expect(ladder.slice(0, grid.length)).toEqual(grid.map((r) => ({ ...r, crf: 25 })));
    expect(ladder[12]).toEqual({ edge: 1024, fps: 30, crf: 29 });
    expect(ladder[24]).toEqual({ edge: 1024, fps: 30, crf: 33 });
    expect(ladder[36]).toEqual({ edge: 1024, fps: 30, crf: 36 });
    expect(ladder[47]).toEqual({ edge: 256, fps: 25, crf: 36 });
  });

  test("fps steps scale with the anim fps", () => {
    const ladder = buildAvifLadder(1024, 60);
    expect(ladder[0]).toEqual({ edge: 1024, fps: 60, crf: 25 });
    expect(ladder[1]).toEqual({ edge: 1024, fps: 50, crf: 25 });
  });

  test("emergency is the best grid shape (maxEdge at anim fps) at crf40", () => {
    expect(avifEmergencyRung(1024, 30)).toEqual({ edge: 1024, fps: 30, crf: 40 });
    expect(avifEmergencyRung(256, 60)).toEqual({ edge: 256, fps: 60, crf: 40 });
  });
});
