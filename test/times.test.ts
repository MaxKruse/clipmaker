import { describe, expect, test } from "bun:test";
import { focusWindow, formatShort, formatTime, frameAt, parseTime } from "../src/lib/times";

describe("parseTime", () => {
  test("parses plain seconds", () => {
    expect(parseTime("90")).toBe(90);
    expect(parseTime("0")).toBe(0);
  });

  test("parses m:ss and m:ss.d", () => {
    expect(parseTime("1:30")).toBe(90);
    expect(parseTime("1:30.5")).toBeCloseTo(90.5);
    expect(parseTime("2:05.25")).toBeCloseTo(125.25);
  });

  test("parses h:mm:ss", () => {
    expect(parseTime("01:02:03")).toBe(3723);
    expect(parseTime("01:02:03.25")).toBeCloseTo(3723.25);
  });

  test("rejects garbage", () => {
    expect(() => parseTime("")).toThrow();
    expect(() => parseTime("abc")).toThrow();
    expect(() => parseTime("1:2:3:4")).toThrow();
    expect(() => parseTime("-5")).toThrow();
    expect(() => parseTime("1.2.3")).toThrow();
  });
});

describe("formatTime", () => {
  test("zero", () => {
    expect(formatTime(0)).toBe("0:00.000");
  });

  test("minutes:seconds.millis", () => {
    expect(formatTime(90.5)).toBe("1:30.500");
    expect(formatTime(5.678)).toBe("0:05.678");
  });

  test("hours prefix when >= 1h", () => {
    expect(formatTime(3723.25)).toBe("1:02:03.250");
    expect(formatTime(3599.999)).toBe("59:59.999");
  });

  test("rounds to millis", () => {
    expect(formatTime(90.0004)).toBe("1:30.000");
    expect(formatTime(90.0006)).toBe("1:30.001");
  });
});

describe("formatShort", () => {
  test("no millis", () => {
    expect(formatShort(90)).toBe("1:30");
    expect(formatShort(5.4)).toBe("0:05");
    expect(formatShort(5.9)).toBe("0:06");
  });

  test("hours prefix", () => {
    expect(formatShort(3723)).toBe("1:02:03");
  });
});

describe("frameAt", () => {
  test("returns the pts of the frame displayed at the given time", () => {
    // 168.52007 is inside the display window of frame 10111 at 60fps
    // ([168.51667, 168.53333)), so the cut must start on 10111.
    expect(frameAt(168.52007299270073, 60)).toBeCloseTo(10111 / 60, 9);
    expect(frameAt(0.1234, 30)).toBeCloseTo(3 / 30, 9);
    expect(frameAt(0, 60)).toBe(0);
  });

  test("keeps exact grid points despite float drift", () => {
    const pts = 10111 / 60; // what a <video> currentTime reports
    expect(frameAt(pts, 60)).toBeCloseTo(pts, 9);
    expect(frameAt(2, 30)).toBe(2);
  });

  test("steps back just before a grid point", () => {
    expect(frameAt(1.999, 30)).toBeCloseTo(59 / 30, 9);
    expect(frameAt(2 - 1e-7, 30)).toBeCloseTo(59 / 30, 6);
  });

  test("works for non-integer fps", () => {
    expect(frameAt(1.0, 29.97)).toBeCloseTo(Math.floor(1.0 * 29.97) / 29.97, 9);
  });

  test("never returns a negative pts", () => {
    expect(frameAt(-0.5, 60)).toBe(0);
  });
});

describe("focusWindow", () => {
  test("pads the clip range on both sides", () => {
    expect(focusWindow(100, 103, 600, 5)).toEqual({ start: 95, end: 108 });
  });

  test("clamps at the start of the video", () => {
    expect(focusWindow(2, 8, 600, 5)).toEqual({ start: 0, end: 13 });
  });

  test("clamps at the end of the video", () => {
    expect(focusWindow(590, 598, 600, 5)).toEqual({ start: 585, end: 600 });
  });

  test("shrinks to the video when the padded window exceeds it", () => {
    expect(focusWindow(1, 2, 6, 5)).toEqual({ start: 0, end: 6 });
  });
});
