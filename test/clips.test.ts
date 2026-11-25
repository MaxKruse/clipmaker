import { expect, test } from "bun:test";
import { initialPlayhead, toClip, toDefaults } from "../src/lib/clips";
import { ANIM_FPS_OPTIONS, ANIM_MAX_EDGE_OPTIONS, ANIM_MAX_MB_OPTIONS, FORMAT_OPTIONS, MP4_FPS_OPTIONS, defaultClip } from "../src/lib/types";

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
      anim: { fps: 60, maxMB: 25, maxEdge: 512 },
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
  expect(c.anim).toEqual({ fps: 60, maxMB: 25, maxEdge: 512 });
});

test("anim fps outside the allowed list falls back to 30", () => {
  const c = toClip({ start: 1, end: 5, formats: ["gif"], anim: { fps: 48, maxMB: 10, maxEdge: 256 } }, v);
  expect(c.anim).toEqual({ fps: 30, maxMB: 10, maxEdge: 256 });
});

test("accepts 1280 and 1440 sharable max edges", () => {
  expect(toClip({ start: 1, end: 5, formats: ["gif"], anim: { maxEdge: 1280 } }, v).anim.maxEdge).toBe(1280);
  expect(toClip({ start: 1, end: 5, formats: ["gif"], anim: { maxEdge: 1440 } }, v).anim.maxEdge).toBe(1440);
});

test("accepts avif as a format", () => {
  const c = toClip({ start: 1, end: 5, formats: ["mp4", "avif"], anim: { maxMB: 10, maxEdge: 512 } }, v);
  expect(c.formats).toEqual(["mp4", "avif"]);
});

test("migrates the legacy gif options key to anim (fps defaults to 30)", () => {
  const c = toClip({ start: 1, end: 5, formats: ["gif"], gif: { maxMB: 25, maxEdge: 768 } }, v);
  expect(c.anim).toEqual({ fps: 30, maxMB: 25, maxEdge: 768 });
});

test("rejects non-numeric start/end", () => {
  expect(() => toClip({ start: "x", end: 5 }, v)).toThrow();
});

test("rejects negative start", () => {
  expect(() => toClip({ start: -1, end: 5, formats: ["mp4"] }, v)).toThrow();
});

test("rejects clips shorter than 0.2s", () => {
  expect(() => toClip({ start: 10, end: 10.1, formats: ["mp4"] }, v)).toThrow(
    "clip must be at least 0.2s long",
  );
});

test("clamps a start past the video duration to the duration", () => {
  const c = toClip({ start: 150, end: 200, formats: ["mp4"] }, v);
  expect(c.start).toBe(100);
  expect(c.end).toBe(100.5);
});

test("a start just before the duration keeps a real tail clip", () => {
  const c = toClip({ start: 99.5, end: 200, formats: ["mp4"] }, v);
  expect(c.start).toBe(99.5);
  expect(c.end).toBe(100.5);
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
      formats: ["mp4", "gif", "avif", "webm"],
      fps: 12,
      quality: { mode: "auto", kbit: 10 },
      gif: { maxMB: 99, maxEdge: 33 },
    },
    v
  );
  expect(c.formats).toEqual(["mp4", "gif", "avif"]);
  expect(c.fps).toBe(60);
  expect(c.quality).toEqual({ mode: "source", kbit: 250 });
  expect(c.anim).toEqual({ fps: 30, maxMB: 48, maxEdge: 1000 });
});

test("drops missing crop", () => {
  const c = toClip({ start: 1, end: 2, formats: ["gif"] }, v);
  expect(c.crop).toBeNull();
});

test("the default clip's values are all selectable in the panel", () => {
  const d = defaultClip();
  for (const f of d.formats) expect(FORMAT_OPTIONS).toContain(f);
  expect(MP4_FPS_OPTIONS).toContain(d.fps);
  expect(ANIM_FPS_OPTIONS).toContain(d.anim.fps);
  expect(ANIM_MAX_MB_OPTIONS).toContain(d.anim.maxMB);
  expect(ANIM_MAX_EDGE_OPTIONS).toContain(d.anim.maxEdge);
});

test("the sharable edges the panel offers are even", () => {
  for (const edge of ANIM_MAX_EDGE_OPTIONS) expect(edge % 2).toBe(0);
});

test("toDefaults: keeps valid fields", () => {
  expect(
    toDefaults({
      formats: ["gif"],
      audio: false,
      fps: 25,
      quality: { mode: "manual", kbit: 5000 },
      anim: { fps: 60, maxMB: 25, maxEdge: 512 },
    })
  ).toEqual({
    formats: ["gif"],
    audio: false,
    fps: 25,
    quality: { mode: "manual", kbit: 5000 },
    anim: { fps: 60, maxMB: 25, maxEdge: 512 },
  });
});

test("toDefaults: garbage falls back to the shipped defaults", () => {
  expect(toDefaults(null)).toEqual({
    formats: ["mp4", "avif"],
    audio: true,
    fps: 60,
    quality: { mode: "source", kbit: 0 },
    anim: { fps: 30, maxMB: 48, maxEdge: 1000 },
  });
});

test("toDefaults: filters bad formats, falls back when none remain", () => {
  expect(toDefaults({ formats: ["mp4", "webm"] }).formats).toEqual(["mp4"]);
  expect(toDefaults({ formats: ["webm"] }).formats).toEqual(["mp4", "avif"]);
});

test("toDefaults: invalid enums fall back per field", () => {
  const d = toDefaults({ fps: 99, anim: { fps: 99, maxMB: 99, maxEdge: 99 } });
  expect(d.fps).toBe(60);
  expect(d.anim).toEqual({ fps: 30, maxMB: 48, maxEdge: 1000 });
});

test("initialPlayhead opens at the first clip in the list", () => {
  expect(initialPlayhead([{ start: 887 }, { start: 100 }], 3735)).toBe(887);
});

test("initialPlayhead opens at 0 with no clips", () => {
  expect(initialPlayhead([], 3735)).toBe(0);
});

test("initialPlayhead clamps a clip start past the duration", () => {
  expect(initialPlayhead([{ start: 9999 }], 100)).toBe(100);
});

test("initialPlayhead never goes below 0", () => {
  expect(initialPlayhead([{ start: -5 }], 100)).toBe(0);
});
