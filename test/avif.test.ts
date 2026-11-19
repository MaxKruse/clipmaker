import { expect, test } from "bun:test";
import { avifDurationLevel } from "../src/lib/avif";

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
