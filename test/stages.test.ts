import { expect, test } from "bun:test";
import { stageText, type JobStage } from "../src/lib/stages";

// The stage text is user-facing (export modal) - these strings are the
// contract. The structured JobStage exists so the runner can build it
// exhaustively; stageText renders it back to the legacy wording.

test("renders the pipeline stages in the legacy wording", () => {
  const cases: [JobStage, string][] = [
    [{ id: "starting" }, "starting"],
    [{ id: "combo-cut", index: 2, total: 4 }, "combine: part 2/4"],
    [{ id: "mp4-encode", encoder: "h264_nvenc", kbit: 4500, fps: 60 }, "mp4 h264_nvenc 4500k 60fps"],
    [{ id: "mp4-encode", encoder: "libx264", kbit: 2500, fps: 30 }, "mp4 libx264 2500k 30fps"],
    [{ id: "mp4-retry" }, "mp4 retry"],
    [{ id: "anim-cut" }, "anim: cut (full-res)"],
    [{ id: "gif-palette" }, "gif: palette"],
    [{ id: "gif-full", edge: 1920, fps: 30 }, "gif: full 1920p30"],
    [{ id: "gif-rung", edge: 512, fps: 25, index: 8, total: 12 }, "gif: sharable 512p25 (8/12)"],
    [{ id: "gif-emergency", edge: 48, fps: 20 }, "gif: sharable 48p20 (emergency)"],
    [{ id: "gif-verify" }, "gif: verify"],
    [{ id: "avif-full", encoder: "libsvtav1", crf: 30 }, "avif: full libsvtav1 crf30"],
    [{ id: "avif-rung", crf: 29, edge: 854, fps: 30, index: 13, total: 48 }, "avif: sharable crf29 854p30 (13/48)"],
    [{ id: "avif-emergency", crf: 40, edge: 256, fps: 30 }, "avif: sharable crf40 256p30 (emergency)"],
    [{ id: "avif-verify" }, "avif: verify"],
  ];
  for (const [stage, text] of cases) {
    expect(stageText(stage)).toBe(text);
  }
});
