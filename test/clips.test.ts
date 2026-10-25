import { expect, test } from "bun:test";
import { toClip } from "../src/lib/clips";

const v = { duration: 100, width: 1920, height: 1080 };

test("accepts a valid clip", () => {
  const c = toClip(
    {
      id: "abc",
      note: "n",
      start: 10,
      end: 20,
      formats: ["mp4"],
      audio: true,
      fps: 25,
      quality: { mode: "manual", kbit: 5000 },
      gif: { maxMB: 25, maxEdge: 512 },
    },
    v
  );
  expect(c.id).toBe("abc");
  expect(c.note).toBe("n");
  expect(c.start).toBe(10);
  expect(c.end).toBe(20);
  expect(c.formats).toEqual(["mp4"]);
  expect(c.audio).toBe(true);
  expect(c.fps).toBe(25);
  expect(c.quality).toEqual({ mode: "manual", kbit: 5000 });
  expect(c.gif).toEqual({ maxMB: 25, maxEdge: 512 });
});

test("rejects non-numeric start/end", () => {
  expect(() => toClip({ start: "x", end: 5 }, v)).toThrow();
});

test("rejects negative start", () => {
  expect(() => toClip({ start: -1, end: 5, formats: ["mp4"] }, v)).toThrow();
});

test("rejects clips shorter than 0.2s", () => {
  expect(() => toClip({ start: 10, end: 10.1, formats: ["mp4"] }, v)).toThrow();
});

test("clamps end to the duration", () => {
  const c = toClip({ start: 99, end: 500, formats: ["mp4"] }, v);
  expect(c.end).toBe(100.5);
});

test("rejects empty formats", () => {
  expect(() => toClip({ start: 1, end: 2, formats: [] }, v)).toThrow();
  expect(() => toClip({ start: 1, end: 2 }, v)).toThrow();
});

test("clamps enums to defaults", () => {
  const c = toClip(
    {
      start: 1,
      end: 2,
      formats: ["mp4", "gif", "webm"],
      fps: 12,
      quality: { mode: "auto", kbit: 10 },
      gif: { maxMB: 99, maxEdge: 33 },
    },
    v
  );
  expect(c.formats).toEqual(["mp4", "gif"]);
  expect(c.fps).toBe(30);
  expect(c.quality).toEqual({ mode: "source", kbit: 250 });
  expect(c.gif).toEqual({ maxMB: 48, maxEdge: 1024 });
});

test("drops missing crop", () => {
  const c = toClip({ start: 1, end: 2, formats: ["gif"] }, v);
  expect(c.crop).toBeNull();
});
