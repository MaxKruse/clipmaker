import { describe, expect, test } from "bun:test";
import { clipSessionReducer, initialClipSession, type ClipSession } from "../src/lib/clipSession";

// The clip session: which clip is under preview, where "back" goes
// (returnTo), the timeline focus window, whether the in/out range is
// live, and the guided add-clip step. These were five independent
// useState calls in page.tsx that moved together in groups; the
// reducer is the single place that knows the groups.

const s = (over: Partial<ClipSession> = {}): ClipSession => ({
  ...initialClipSession,
  ...over,
});

const select = (playhead: number) => ({
  type: "select-clip",
  clipId: "c1",
  start: 10,
  end: 15,
  playhead,
} as const);

describe("clipSessionReducer", () => {
  test("starts fresh: no preview, no range, idle step", () => {
    expect(initialClipSession).toEqual({
      clipId: null,
      returnTo: null,
      focus: null,
      hasRange: false,
      step: "idle",
    });
  });

  test("selecting a clip previews it: range live, focus framed, step idle", () => {
    const r = clipSessionReducer(s(), select(3));
    expect(r).toEqual({ clipId: "c1", returnTo: 3, focus: { start: 10, end: 15 }, hasRange: true, step: "idle" });
  });

  test("consecutive clip jumps keep the original returnTo", () => {
    let r = clipSessionReducer(s(), select(3));
    r = clipSessionReducer(r, { ...select(99), clipId: "c2", start: 20, end: 25 });
    expect(r.returnTo).toBe(3);
    expect(r.clipId).toBe("c2");
    expect(r.focus).toEqual({ start: 20, end: 25 });
  });

  test("after the pending return is cancelled, the next jump re-captures", () => {
    let r = clipSessionReducer(s(), select(3));
    r = clipSessionReducer(r, { type: "cancel-return" });
    expect(r.returnTo).toBeNull();
    r = clipSessionReducer(r, { ...select(7), clipId: "c2" });
    expect(r.returnTo).toBe(7);
  });

  test("add-clip with no live range goes to set-times; with one, to crop", () => {
    expect(clipSessionReducer(s(), { type: "add-clip", clipId: "n1" }).step).toBe("set-times");
    expect(clipSessionReducer(s({ hasRange: true }), { type: "add-clip", clipId: "n1" }).step).toBe("crop");
  });

  test("add-clip keeps a pending returnTo and selects the new clip", () => {
    const r = clipSessionReducer(
      s({ returnTo: 5, clipId: "c1", focus: { start: 1, end: 2 } }),
      { type: "add-clip", clipId: "n1" },
    );
    expect(r.clipId).toBe("n1");
    expect(r.returnTo).toBe(5);
    expect(r.hasRange).toBe(true);
  });

  test("patching times finishes set-times; patching crop finishes crop", () => {
    let r = clipSessionReducer(s(), { type: "add-clip", clipId: "n1" });
    r = clipSessionReducer(r, { type: "patched", patch: { note: "x" } });
    expect(r.step).toBe("set-times"); // untouched by a note patch
    r = clipSessionReducer(r, { type: "patched", patch: { start: 1 } });
    expect(r.step).toBe("crop");

    r = clipSessionReducer(s({ step: "crop" }), { type: "patched", patch: { note: "x" } });
    expect(r.step).toBe("crop"); // untouched by a note patch
    r = clipSessionReducer(r, { type: "patched", patch: { crop: { x: 0, y: 0, w: 16, h: 16 } } });
    expect(r.step).toBe("idle");
  });

  test("clearing the crop does not finish the crop step", () => {
    const r = clipSessionReducer(s({ step: "crop" }), { type: "patched", patch: { crop: null } });
    expect(r.step).toBe("crop");
  });

  test("set-range makes the range live and drops the pending return", () => {
    const r = clipSessionReducer(s({ returnTo: 9 }), { type: "set-range" });
    expect(r.hasRange).toBe(true);
    expect(r.returnTo).toBeNull();
  });

  test("cancel-return only clears the return", () => {
    const r = clipSessionReducer(
      s({ returnTo: 9, clipId: "c1", focus: { start: 1, end: 2 }, hasRange: true, step: "set-times" }),
      { type: "cancel-return" },
    );
    expect(r).toEqual({ clipId: "c1", returnTo: null, focus: { start: 1, end: 2 }, hasRange: true, step: "set-times" });
  });

  test("clear-range only kills the live range", () => {
    const r = clipSessionReducer(s({ hasRange: true, clipId: "c1" }), { type: "clear-range" });
    expect(r.hasRange).toBe(false);
    expect(r.clipId).toBe("c1");
  });

  test("deselect (deleting the last previewed clip) keeps the return", () => {
    const r = clipSessionReducer(
      s({ clipId: "c1", returnTo: 4, focus: { start: 1, end: 2 }, hasRange: true, step: "set-times" }),
      { type: "deselect" },
    );
    expect(r).toEqual({ clipId: null, returnTo: 4, focus: null, hasRange: false, step: "idle" });
  });

  test("leaving the preview resets the whole session", () => {
    const deep = s({ clipId: "c1", returnTo: 4, focus: { start: 1, end: 2 }, hasRange: true, step: "crop" });
    expect(clipSessionReducer(deep, { type: "leave-preview" })).toEqual(initialClipSession);
  });

  test("switching video resets the whole session", () => {
    const deep = s({ clipId: "c1", returnTo: 4, focus: { start: 1, end: 2 }, hasRange: true, step: "crop" });
    expect(clipSessionReducer(deep, { type: "video-changed" })).toEqual(initialClipSession);
  });

  test("an import goes back to the idle step", () => {
    expect(clipSessionReducer(s({ step: "set-times" }), { type: "imported" }).step).toBe("idle");
    expect(clipSessionReducer(s(), { type: "imported" }).step).toBe("idle");
  });
});
