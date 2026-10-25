import { describe, expect, test } from "bun:test";
import { parseClipsTxt, sectionForVideo } from "../src/lib/clipsTxt";

describe("parseClipsTxt", () => {
  test("parses m:ss ranges with notes", () => {
    const { sections, skipped } = parseClipsTxt("14:47 - 15:22 Cute\n20:42 - 20:58 Hiding Clippable\n");
    expect(skipped).toBe(0);
    expect(sections).toHaveLength(1);
    expect(sections[0].clips).toEqual([
      { start: 887, end: 922, note: "Cute" },
      { start: 1242, end: 1258, note: "Hiding Clippable" },
    ]);
  });

  test("parses h:mm:ss and keeps notes with dashes, quotes, parens", () => {
    const { sections, skipped } = parseClipsTxt(
      '1:01:41 - 1:02:54 Guh\n25:04 - 25:18 "Im a wiggle streamer" mp4\n30:10 - 30:48 CoolAss Giffable (No MP4!)\n',
    );
    expect(skipped).toBe(0);
    expect(sections[0].clips).toEqual([
      { start: 3701, end: 3774, note: "Guh" },
      { start: 1504, end: 1518, note: '"Im a wiggle streamer" mp4' },
      { start: 1810, end: 1848, note: "CoolAss Giffable (No MP4!)" },
    ]);
  });

  test("splits sections on # headers and tolerates blank lines", () => {
    const text = ["# vod_one.mp4", "", "10:00 - 10:30 a", "", "# vod_two", "0:20 - 0:40 b", ""].join("\n");
    const { sections, skipped } = parseClipsTxt(text);
    expect(skipped).toBe(0);
    // Index 0 is the anonymous section for clips before any header.
    expect(sections.map((s) => s.title)).toEqual(["", "vod_one.mp4", "vod_two"]);
    expect(sections[0].clips).toHaveLength(0);
    expect(sections[1].clips).toHaveLength(1);
    expect(sections[2].clips).toHaveLength(1);
    expect(sections[2].clips[0].note).toBe("b");
  });

  test("counts garbage, non-time, and inverted ranges as skipped", () => {
    const text = ["no times here", "14:47 - something", "15:00 - 14:30 inverted", "1:2:3:4 - 9:00 bad"].join("\n");
    const { sections, skipped } = parseClipsTxt(text);
    expect(skipped).toBe(4);
    expect(sections[0].clips).toHaveLength(0);
  });

  test("empty input yields one empty section", () => {
    const { sections, skipped } = parseClipsTxt("");
    expect(skipped).toBe(0);
    expect(sections).toEqual([{ title: "", clips: [] }]);
  });
});

describe("sectionForVideo", () => {
  const sections = [
    { title: "twitch_sleepylulu_2026-10-21 07-01-58_1080p_VRChat_(stream one)", clips: [{ start: 1, end: 2, note: "" }] },
    { title: "twitch_sleepylulu_2026-10-22 12-44-35_1080p_VRChat_(stream two)", clips: [{ start: 3, end: 4, note: "" }] },
    { title: "twitch_sleepylulu_2026-10-24 02-00-30_1080p_VRChat_(stream three).mp4", clips: [{ start: 5, end: 6, note: "" }] },
  ];

  test("matches by file name without extension, case-insensitive", () => {
    expect(
      sectionForVideo(sections, "TWITCH_SLEEPYLUlu_2026-10-21 07-01-58_1080p_VRChat.mp4"),
    ).toBe(sections[0]);
  });

  test("matches a header that includes the .mp4 extension", () => {
    expect(
      sectionForVideo(sections, "twitch_sleepylulu_2026-10-24 02-00-30_1080p_VRChat_(stream three).mp4"),
    ).toBe(sections[2]);
  });

  test("returns null for no match and for ambiguous matches", () => {
    expect(sectionForVideo(sections, "unrelated_video.mp4")).toBeNull();
    expect(sectionForVideo(sections, "twitch_sleepylulu_2026-10-22 12-44-35_1080p_VRChat_(stream two).mp4")).toBe(sections[1]);
    const both = [sections[0], { ...sections[0], title: sections[0].title + " rerun" }];
    expect(sectionForVideo(both, "twitch_sleepylulu_2026-10-21 07-01-58_1080p_VRChat.mp4")).toBeNull();
  });

  test("ignores sections without clips", () => {
    const withEmpty = [sections[0], { title: "twitch_sleepylulu_2026-10-21 07-01-58_1080p_VRChat_(stream one) take2", clips: [] }];
    expect(sectionForVideo(withEmpty, "twitch_sleepylulu_2026-10-21 07-01-58_1080p_VRChat.mp4")).toBe(sections[0]);
  });
});
