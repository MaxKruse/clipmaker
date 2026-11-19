import { expect, test } from "bun:test";
import { defaultClip, defaultClipDefaults, toggleFormatIn } from "../src/lib/types";

test("toggleFormatIn: adds an unselected format", () => {
  expect(toggleFormatIn(["mp4"], "gif")).toEqual(["mp4", "gif"]);
});

test("toggleFormatIn: removes a selected format", () => {
  expect(toggleFormatIn(["mp4", "avif"], "mp4")).toEqual(["avif"]);
});

test("toggleFormatIn: null when the only format would be removed", () => {
  expect(toggleFormatIn(["mp4"], "mp4")).toBeNull();
});

test("defaultClip: MP4 defaults to 60 fps", () => {
  expect(defaultClip().fps).toBe(60);
});

test("defaultClip: GIF/AVIF anim fps defaults to 30", () => {
  expect(defaultClip().anim).toEqual({ fps: 30, maxMB: 48, maxEdge: 1000 });
});

test("defaultClip: new clips default to mp4 + avif (gif is opt-in)", () => {
  expect(defaultClip().formats).toEqual(["mp4", "avif"]);
});

test("defaultClipDefaults: the shipped defaults", () => {
  expect(defaultClipDefaults()).toEqual({
    formats: ["mp4", "avif"],
    audio: true,
    fps: 60,
    quality: { mode: "source", kbit: 0 },
    anim: { fps: 30, maxMB: 48, maxEdge: 1000 },
  });
});

test("defaultClip: custom defaults fill formats, audio, fps, quality, anim", () => {
  const d = defaultClipDefaults();
  d.formats = ["gif"];
  d.audio = false;
  d.fps = 25;
  d.quality = { mode: "manual", kbit: 5000 };
  d.anim = { fps: 15, maxMB: 10, maxEdge: 256 };
  const c = defaultClip("n", d);
  expect(c.note).toBe("n");
  expect(c.formats).toEqual(["gif"]);
  expect(c.audio).toBe(false);
  expect(c.fps).toBe(25);
  expect(c.quality).toEqual({ mode: "manual", kbit: 5000 });
  expect(c.anim).toEqual({ fps: 15, maxMB: 10, maxEdge: 256 });
  // The clip range is always fresh.
  expect(c.start).toBe(0);
  expect(c.end).toBe(5);
  expect(c.crop).toBeNull();
});

test("defaultClip: mutating the result does not touch the defaults", () => {
  const d = defaultClipDefaults();
  const c = defaultClip("", d);
  c.formats.push("gif");
  c.anim.maxEdge = 256;
  expect(d.formats).toEqual(["mp4", "avif"]);
  expect(d.anim.maxEdge).toBe(1000);
});
