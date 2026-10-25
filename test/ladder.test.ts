import { describe, expect, test } from "bun:test";
import { buildLadder, emergencyRung, pickRungIndex } from "../src/lib/ladder";

describe("buildLadder", () => {
  test("1024px ladder matches the skill recipe", () => {
    expect(buildLadder(1024)).toEqual([
      { edge: 1024, fps: 30 },
      { edge: 1024, fps: 25 },
      { edge: 768, fps: 25 },
      { edge: 640, fps: 25 },
      { edge: 512, fps: 25 },
      { edge: 384, fps: 25 },
      { edge: 256, fps: 25 },
    ]);
  });

  test("640px ladder scales the same ratios", () => {
    expect(buildLadder(640)).toEqual([
      { edge: 640, fps: 30 },
      { edge: 640, fps: 25 },
      { edge: 480, fps: 25 },
      { edge: 400, fps: 25 },
      { edge: 320, fps: 25 },
      { edge: 240, fps: 25 },
      { edge: 160, fps: 25 },
    ]);
  });

  test("edges are always even", () => {
    for (const maxEdge of [1024, 768, 640, 512, 256, 192]) {
      for (const rung of buildLadder(maxEdge)) {
        expect(rung.edge % 2).toBe(0);
        expect(rung.edge).toBeGreaterThan(0);
      }
    }
  });
});

describe("emergencyRung", () => {
  test("192@25 for 1024px", () => {
    expect(emergencyRung(1024)).toEqual({ edge: 192, fps: 25 });
  });

  test("scales with max edge", () => {
    expect(emergencyRung(640)).toEqual({ edge: 120, fps: 25 });
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
