import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { outputsGone, outputPath, saveTimestampsMirror, safeOutputName } from "../src/lib/jobFiles";
import { defaultClip, type Job, type JobOutput } from "../src/lib/types";

const job = (id: string, clipNo: number, createdAt: number): Job => ({
  id,
  videoId: "v1",
  videoName: "v1.mp4",
  clip: { ...defaultClip(), id: "c-" + id },
  clipNo,
  status: "queued",
  stage: null,
  pct: 0,
  outputs: [],
  createdAt,
});

const out = (kind: JobOutput["kind"], name: string, tier?: JobOutput["tier"]): JobOutput => ({
  kind,
  name,
  size: 1,
  tier,
});

describe("safeOutputName", () => {
  test("accepts bare names and the sharable/ and highlights/ subfolders", () => {
    expect(safeOutputName("clip1-note.mp4")).toBe(true);
    expect(safeOutputName("Dance-highlights.mp4")).toBe(true);
    expect(safeOutputName("sharable/clip1-1024.gif")).toBe(true);
    expect(safeOutputName("highlights/Dance-highlights.mp4")).toBe(true);
  });

  test("rejects escapes, deep paths, unknown subfolders, and empty names", () => {
    expect(safeOutputName("..")).toBe(false);
    expect(safeOutputName("sharable/../clip1.mp4")).toBe(false);
    expect(safeOutputName("/abs.mp4")).toBe(false);
    expect(safeOutputName("sharable/deep/file.mp4")).toBe(false);
    expect(safeOutputName("other/file.mp4")).toBe(false);
    expect(safeOutputName("")).toBe(false);
  });
});

describe("outputsGone", () => {
  const OUT = "out";
  const seenPaths = (j: Job, present: string[]) => {
    const seen: string[] = [];
    outputsGone(j, OUT, (p) => {
      seen.push(p);
      return present.some((f) => p.endsWith(f));
    });
    return seen;
  };

  test("a done job whose outputs are all deleted is gone", () => {
    const j: Job = { ...job("j1", 1, 1), status: "done", outputs: [out("mp4", "clip1.mp4")] };
    expect(outputsGone(j, OUT, () => false)).toBe(true);
  });

  test("one surviving output keeps the row", () => {
    const j: Job = {
      ...job("j1", 1, 1),
      status: "done",
      outputs: [out("mp4", "clip1.mp4"), out("gif", "sharable/clip1-512.gif", "sharable")],
    };
    expect(outputsGone(j, OUT, (p) => p.endsWith("clip1.mp4"))).toBe(false);
  });

  test("a done job with no outputs is kept (unverifiable, not dropped)", () => {
    const j: Job = { ...job("j1", 1, 1), status: "done", outputs: [] };
    expect(outputsGone(j, OUT, () => false)).toBe(false);
  });

  test("non-done rows are history, never dropped", () => {
    const err: Job = { ...job("j1", 1, 1), status: "error", outputs: [] };
    expect(outputsGone(err, OUT, () => false)).toBe(false);
    expect(outputsGone(job("j1", 1, 1), OUT, () => false)).toBe(false); // queued
  });

  test("checks the video's export dir, date subfolder included for dated ids", () => {
    const j: Job = {
      ...job("j1", 1, 1),
      videoId: "2026-11-19_ab12cd34",
      status: "done",
      outputs: [out("mp4", "clip1.mp4")],
    };
    expect(seenPaths(j, [])).toEqual([
      path.join(OUT, "2026-11-19_ab12cd34", "2026-11-19", "clip1.mp4"),
    ]);
  });

  test("undated ids check the flat layout", () => {
    const j: Job = { ...job("j1", 1, 1), status: "done", outputs: [out("mp4", "clip1.mp4")] };
    expect(seenPaths(j, [])).toEqual([path.join(OUT, "v1", "clip1.mp4")]);
  });
});

describe("outputPath", () => {
  test("undated ids resolve flat under out/<videoId>/", () => {
    expect(outputPath("out", "v1", "clip1.mp4")).toBe(path.join("out", "v1", "clip1.mp4"));
  });

  test("dated ids resolve into the date subfolder", () => {
    expect(outputPath("out", "2026-11-19_ab12cd34", "clip1.mp4")).toBe(
      path.join("out", "2026-11-19_ab12cd34", "2026-11-19", "clip1.mp4"),
    );
  });

  test("sharable and highlights names keep their subfolder", () => {
    expect(outputPath("out", "v1", "sharable/clip1-512.gif")).toBe(
      path.join("out", "v1", "sharable", "clip1-512.gif"),
    );
    expect(outputPath("out", "2026-11-19_ab12cd34", "highlights/Dance-highlights.mp4")).toBe(
      path.join("out", "2026-11-19_ab12cd34", "2026-11-19", "highlights", "Dance-highlights.mp4"),
    );
  });
});

describe("saveTimestampsMirror", () => {
  test("writes one line per clip at the video root (never the date subfolder)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clipmaker-mirror-"));
    try {
      saveTimestampsMirror("2026-11-19_ab12cd34", [{ start: 10, end: 20.5, note: "a" }], dir);
      expect(
        fs.readFileSync(path.join(dir, "2026-11-19_ab12cd34", "timestamps.txt"), "utf8"),
      ).toBe("0:10 - 0:20.5 a\n");
      expect(fs.existsSync(path.join(dir, "2026-11-19_ab12cd34", "2026-11-19"))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an empty clip list deletes the mirror file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clipmaker-mirror-"));
    try {
      saveTimestampsMirror("v1", [{ start: 10, end: 20, note: "" }], dir);
      saveTimestampsMirror("v1", [], dir);
      expect(fs.existsSync(path.join(dir, "v1", "timestamps.txt"))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ids that could escape the out dir are ignored", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clipmaker-mirror-"));
    try {
      saveTimestampsMirror("../evil", [{ start: 10, end: 20, note: "x" }], dir);
      expect(fs.existsSync(path.join(dir, "..", "evil", "timestamps.txt"))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
