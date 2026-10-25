import { describe, expect, test } from "bun:test";
import { formatShort, formatTime, parseTime } from "../src/lib/times";

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
