import { describe, expect, test } from "bun:test";
import {
  COMBO_FADE_SECONDS,
  COMBO_SHARE_FPS,
  COMBO_SHARE_MAX_MB,
  comboDuration,
  comboFade,
  comboShareRungs,
  comboTarget,
  groupCombine,
} from "../src/lib/combine";
import type { ClipSpec, VideoInfo } from "../src/lib/types";

const VIDEO: VideoInfo = {
  id: "v1",
  name: "vod.mp4",
  path: "vod.mp4",
  uploaded: false,
  duration: 3600,
  width: 1920,
  height: 1080,
  fps: 60,
  hasAudio: true,
  videoKbit: 8000,
  audioKbit: 192,
  formatKbit: 8192,
  sizeBytes: 1,
};

const clip = (over: Partial<ClipSpec> & { note: string }): ClipSpec => ({
  id: over.note,
  start: 0,
  end: 10,
  crop: null,
  formats: ["mp4"],
  audio: true,
  fps: 60,
  quality: { mode: "source", kbit: 0 },
  anim: { fps: 30, maxMB: 48, maxEdge: 1000 },
  ...over,
});

describe("groupCombine", () => {
  test("groups by trimmed lowercased note, keeping list order as part order", () => {
    const a = clip({ note: "Dance", start: 0, end: 10 });
    const b = clip({ note: "dance", start: 20, end: 30 });
    const c = clip({ note: "  Dance ", start: 40, end: 50 });
    const d = clip({ note: "Solo", start: 60, end: 70 });
    const e = clip({ note: "dance", start: 80, end: 90 });
    const groups = groupCombine([a, b, d, c, e]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual([a, b, c, e]);
    expect(groups[1]).toEqual([d]);
  });

  test("nameless clips are never combined (each keeps its own group)", () => {
    const a = clip({ note: "" });
    const b = clip({ note: "   " });
    const c = clip({ note: "x" });
    const groups = groupCombine([a, b, c, a]);
    expect(groups).toHaveLength(4);
    for (const g of groups) expect(g).toHaveLength(1);
  });

  test("empty input -> no groups", () => {
    expect(groupCombine([])).toEqual([]);
  });
});

describe("comboFade", () => {
  test("is the fixed 0.5s per edge for normal parts", () => {
    expect(comboFade(5)).toBe(COMBO_FADE_SECONDS);
    expect(comboFade(10)).toBe(0.5);
  });

  test("clamps to half the part for short parts (in and out never overlap past the midpoint)", () => {
    expect(comboFade(0.6)).toBe(0.3);
    expect(comboFade(0.2)).toBe(0.1);
  });
});

describe("comboDuration", () => {
  test("sums each part's cut duration with the frame-floored start", () => {
    const clips = [
      clip({ note: "a", start: 1.02, end: 6.03 }),
      clip({ note: "b", start: 20.5, end: 25.75 }),
    ];
    // 60fps grid: 1.02 -> 1.0166.., 20.5 -> 20.5
    const d = comboDuration(clips, 60);
    expect(d).toBeCloseTo(6.03 - Math.floor(1.02 * 60) / 60 + 5.25, 6);
  });
});

describe("comboTarget", () => {
  test("the LARGEST clip's effective size is form-giving, in either order", () => {
    const cropped = clip({ note: "a", crop: { x: 100, y: 50, w: 640, h: 360 } });
    const full = clip({ note: "a", crop: null });
    expect(comboTarget([cropped, full], VIDEO)).toEqual({ w: 1920, h: 1080 });
    expect(comboTarget([full, cropped], VIDEO)).toEqual({ w: 1920, h: 1080 });
  });

  test("a crop larger than the source frame defines the target", () => {
    const bigCrop = clip({ note: "a", crop: { x: 0, y: 0, w: 1920, h: 1080 } });
    const smallCrop = clip({ note: "a", crop: { x: 100, y: 50, w: 640, h: 360 } });
    expect(comboTarget([smallCrop, bigCrop], VIDEO)).toEqual({ w: 1920, h: 1080 });
    expect(comboTarget([bigCrop, smallCrop], VIDEO)).toEqual({ w: 1920, h: 1080 });
  });

  test("largest by area, not by longest edge", () => {
    const strip = clip({ note: "a", crop: { x: 0, y: 0, w: 1920, h: 300 } });
    const square = clip({ note: "a", crop: { x: 0, y: 0, w: 900, h: 900 } });
    // 900x900 (810k) beats 1920x300 (576k) despite the shorter longest edge
    expect(comboTarget([strip, square], VIDEO)).toEqual({ w: 900, h: 900 });
    expect(comboTarget([square, strip], VIDEO)).toEqual({ w: 900, h: 900 });
  });

  test("equal area: the earlier clip in list order wins", () => {
    const wide = clip({ note: "a", crop: { x: 0, y: 0, w: 1280, h: 360 } });
    const other = clip({ note: "a", crop: { x: 0, y: 0, w: 720, h: 640 } });
    expect(comboTarget([wide, other], VIDEO)).toEqual({ w: 1280, h: 360 });
    expect(comboTarget([other, wide], VIDEO)).toEqual({ w: 720, h: 640 });
  });
});

describe("sharable combined tier", () => {
  test("constants: 30fps fixed, 48MB cap", () => {
    expect(COMBO_SHARE_FPS).toBe(30);
    expect(COMBO_SHARE_MAX_MB).toBe(48);
  });
});

describe("comboShareRungs", () => {
  test("full 1080p tier: the three fixed edges, highest quality first", () => {
    expect(comboShareRungs(1920, 1080)).toEqual([768, 512, 256]);
  });

  test("never upscales: a 480p tier starts at its own longest edge", () => {
    expect(comboShareRungs(480, 270)).toEqual([480, 256]);
    expect(comboShareRungs(256, 144)).toEqual([256]);
  });

  test("a tier between two fixed edges is prepended and deduped", () => {
    expect(comboShareRungs(700, 394)).toEqual([700, 512, 256]);
  });

  test("below the smallest rung: a single rung at the full edge", () => {
    expect(comboShareRungs(200, 112)).toEqual([200]);
  });

  test("odd full edges are even-floored", () => {
    expect(comboShareRungs(701, 393)).toEqual([700, 512, 256]);
    expect(comboShareRungs(257, 144)).toEqual([256]);
  });

  test("a portrait frame is driven by its longest edge (height)", () => {
    expect(comboShareRungs(400, 800)).toEqual([768, 512, 256]);
  });
});
