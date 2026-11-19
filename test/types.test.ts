import { expect, test } from "bun:test";
import { defaultClip } from "../src/lib/types";

test("defaultClip: MP4 defaults to 60 fps", () => {
  expect(defaultClip().fps).toBe(60);
});

test("defaultClip: GIF/AVIF anim fps defaults to 30", () => {
  expect(defaultClip().anim).toEqual({ fps: 30, maxMB: 48, maxEdge: 1000 });
});

test("defaultClip: new clips default to mp4 + avif (gif is opt-in)", () => {
  expect(defaultClip().formats).toEqual(["mp4", "avif"]);
});
