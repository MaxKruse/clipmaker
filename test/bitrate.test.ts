import { describe, expect, test } from "bun:test";
import { resolveSourceKbit, round50k, targetVideoKbit } from "../src/lib/bitrate";

describe("round50k", () => {
  test("rounds to 50k units", () => {
    expect(round50k(2501.5)).toBe(2500);
    expect(round50k(2084.58)).toBe(2100);
    expect(round50k(2525)).toBe(2550);
  });

  test("floor at 500k", () => {
    expect(round50k(100)).toBe(500);
    expect(round50k(499.9)).toBe(500);
    expect(round50k(500)).toBe(500);
  });
});

describe("targetVideoKbit", () => {
  test("scales with fps reduction (skill examples)", () => {
    // 5003k source at 60fps -> 30fps and 25fps
    expect(targetVideoKbit(5003, 60, 30)).toBe(2500);
    expect(targetVideoKbit(5003, 60, 25)).toBe(2100);
  });

  test("same fps keeps source bitrate", () => {
    expect(targetVideoKbit(6000, 30, 30)).toBe(6000);
    expect(targetVideoKbit(8000, 25, 25)).toBe(8000);
  });

  test("low source floors at 500k", () => {
    expect(targetVideoKbit(300, 30, 30)).toBe(500);
  });

  test("higher out fps scales up", () => {
    // 30fps source -> 60fps doubles the target
    expect(targetVideoKbit(3000, 30, 60)).toBe(6000);
  });
});

describe("resolveSourceKbit", () => {
  test("prefers stream bit_rate", () => {
    expect(resolveSourceKbit({ videoKbit: 5003, formatKbit: 6000, audioKbit: 96 })).toBe(5003);
  });

  test("falls back to format minus audio", () => {
    expect(resolveSourceKbit({ videoKbit: null, formatKbit: 8000, audioKbit: 128 })).toBe(7872);
  });

  test("falls back to 6000k when nothing usable", () => {
    expect(resolveSourceKbit({ videoKbit: null, formatKbit: null, audioKbit: null })).toBe(6000);
    expect(resolveSourceKbit({ videoKbit: null, formatKbit: 100, audioKbit: 128 })).toBe(6000);
  });
});
