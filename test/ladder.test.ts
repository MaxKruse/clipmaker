import { describe, expect, test } from "bun:test";
import {
  avifEmergencyCrf,
  buildAvifCrfLadder,
  buildLadder,
  emergencyRung,
  pickRungIndex,
} from "../src/lib/ladder";

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

describe("pickRungIndex", () => {
  const sizes = [null, 62.3, 52.6, 32.3, 23.3, 15.2, 4.5]; // MB, first rung failed

  test("first rung under cap wins", () => {
    expect(pickRungIndex(sizes, 48)).toBe(3);
  });

  test("null sizes are skipped", () => {
    expect(pickRungIndex([null, null, 10, 20], 48)).toBe(2);
  });

  test("no rung under cap -> -1", () => {
    expect(pickRungIndex([100, 200, 300], 48)).toBe(-1);
  });

  test("empty -> -1", () => {
    expect(pickRungIndex([], 48)).toBe(-1);
  });
});

describe("AVIF crf ladder", () => {
  test("steps down from high quality to low (higher crf = smaller)", () => {
    expect(buildAvifCrfLadder()).toEqual([30, 34, 38, 42, 46, 50]);
  });

  test("emergency crf is lower quality than the last rung", () => {
    expect(avifEmergencyCrf()).toBe(54);
  });
});
