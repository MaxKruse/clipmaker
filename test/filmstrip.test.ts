import { describe, expect, test } from "bun:test";
import { filmstripPlan } from "../src/lib/filmstrip";

describe("filmstripPlan", () => {
  test("caps the thumbnail count for long videos", () => {
    const { interval, times } = filmstripPlan(3735);
    expect(interval).toBe(38);
    expect(times.length).toBeLessThanOrEqual(100);
    expect(times[0]).toBe(0);
    expect(times[times.length - 1]).toBeLessThan(3735);
  });

  test("uses the 2s floor for short videos", () => {
    const { interval, times } = filmstripPlan(60);
    expect(interval).toBe(2);
    expect(times.length).toBe(30);
  });

  test("respects the maxThumbs override", () => {
    const { interval, times } = filmstripPlan(600, 10);
    expect(interval).toBe(60);
    expect(times.length).toBe(10);
  });

  test("never samples past the duration", () => {
    const { times } = filmstripPlan(100, 100);
    for (const t of times) expect(t).toBeLessThan(100);
  });

  test("empty duration yields no thumbnails", () => {
    expect(filmstripPlan(0)).toEqual({ interval: 2, times: [] });
  });

  test("ascending, evenly spaced times", () => {
    const { times } = filmstripPlan(200, 50);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThan(times[i - 1]);
    }
  });
});
