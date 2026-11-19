import { expect, test } from "bun:test";
import { avifDurationLevel, avifWarningText } from "../src/lib/avif";

test("avifWarningText: warn sentence with the rounded seconds", () => {
  expect(avifWarningText("warn", 47.4)).toBe("AVIF: a 47s clip - expect a slow AV1 encode");
});

test("avifWarningText: danger sentence", () => {
  expect(avifWarningText("danger", 90.6)).toBe("AVIF: a 91s clip - the AV1 encode will take a long time");
});

test("avifDurationLevel: clips up to 45s are fine", () => {
  expect(avifDurationLevel(0)).toBe("none");
  expect(avifDurationLevel(10)).toBe("none");
  expect(avifDurationLevel(45)).toBe("none");
});

test("avifDurationLevel: over 45s warns", () => {
  expect(avifDurationLevel(45.1)).toBe("warn");
  expect(avifDurationLevel(50)).toBe("warn");
  expect(avifDurationLevel(60)).toBe("warn");
});

test("avifDurationLevel: over 60s is danger", () => {
  expect(avifDurationLevel(60.1)).toBe("danger");
  expect(avifDurationLevel(120)).toBe("danger");
});
