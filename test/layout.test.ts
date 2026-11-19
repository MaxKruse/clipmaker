import { expect, test } from "bun:test";
import { LAYOUT_LIMITS, clampLayout, defaultLayout, loadLayout, saveLayout } from "../src/lib/layout";

test("clampLayout: in-range values are untouched", () => {
  const l = { right: 480, stage: 300, strip: 120, options: 200 };
  expect(clampLayout(l)).toEqual(l);
});

test("clampLayout: each field is clamped into its limits", () => {
  const out = clampLayout({ right: -5, stage: 99999, strip: 0.1, options: 1e9 });
  expect(out.right).toBe(LAYOUT_LIMITS.right[0]);
  expect(out.stage).toBe(LAYOUT_LIMITS.stage[1]);
  expect(out.strip).toBe(LAYOUT_LIMITS.strip[0]);
  expect(out.options).toBe(LAYOUT_LIMITS.options[1]);
});

test("clampLayout: null heights stay null", () => {
  expect(clampLayout({ ...defaultLayout })).toEqual(defaultLayout);
  expect(clampLayout({ ...defaultLayout, stage: null, options: null }).stage).toBeNull();
});

test("loadLayout: no stored value gives the defaults", () => {
  expect(loadLayout(() => null)).toEqual(defaultLayout);
  expect(loadLayout(() => "")).toEqual(defaultLayout);
});

test("loadLayout: corrupt JSON self-heals to the defaults", () => {
  expect(loadLayout(() => "{not json")).toEqual(defaultLayout);
  expect(loadLayout(() => JSON.stringify(["an array"]))).toEqual(defaultLayout);
  expect(loadLayout(() => JSON.stringify(null))).toEqual(defaultLayout);
});

test("loadLayout: partial storage fills in the missing fields", () => {
  const out = loadLayout(() => JSON.stringify({ right: 520 }));
  expect(out).toEqual({ ...defaultLayout, right: 520 });
});

test("loadLayout: non-numeric and non-finite values are ignored", () => {
  const out = loadLayout(() =>
    JSON.stringify({ right: "480", stage: Infinity, strip: NaN, options: { px: 1 } }),
  );
  expect(out).toEqual(defaultLayout);
});

test("loadLayout: out-of-range stored values are clamped", () => {
  const out = loadLayout(() => JSON.stringify({ right: 10, stage: 5, strip: 5, options: 5 }));
  expect(out.right).toBe(LAYOUT_LIMITS.right[0]);
  expect(out.stage).toBe(LAYOUT_LIMITS.stage[0]);
  expect(out.strip).toBe(LAYOUT_LIMITS.strip[0]);
  expect(out.options).toBe(LAYOUT_LIMITS.options[0]);
});

test("saveLayout: writes the clamped JSON", () => {
  let written: string | null = null;
  saveLayout((s) => (written = s), { right: 9999, stage: 300, strip: null, options: null });
  expect(JSON.parse(written!)).toEqual({ right: LAYOUT_LIMITS.right[1], stage: 300, strip: null, options: null });
});

test("saveLayout: a failing write is swallowed", () => {
  expect(() =>
    saveLayout(() => {
      throw new Error("quota");
    }, defaultLayout),
  ).not.toThrow();
});

test("loadLayout: a throwing reader self-heals to the defaults", () => {
  expect(
    loadLayout(() => {
      throw new Error("storage blocked");
    }),
  ).toEqual(defaultLayout);
});
