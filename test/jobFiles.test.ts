import { describe, expect, test } from "bun:test";
import path from "node:path";
import { outputsGone } from "../src/lib/jobFiles";
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
