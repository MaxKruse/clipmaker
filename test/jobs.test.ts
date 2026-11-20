import { describe, expect, test } from "bun:test";
import path from "node:path";
import { batchTimeLabel, findOutput, groupBatches, isActiveJob, jobCounts, outputsGone, resolveTier, sortJobs } from "../src/lib/jobs";
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

describe("sortJobs", () => {
  test("one batch renders in clip order, top to bottom", () => {
    // One export request stamps every job with the same createdAt.
    const a = job("a", 1, 1000);
    const b = job("b", 2, 1000);
    const c = job("c", 3, 1000);
    expect(sortJobs([a, b, c]).map((j) => j.id)).toEqual(["a", "b", "c"]);
  });

  test("the newest batch comes first, batches keep their clip order", () => {
    const a1 = job("a1", 1, 1000);
    const a2 = job("a2", 2, 1000);
    const a3 = job("a3", 3, 1000);
    const b1 = job("b1", 1, 2000);
    const b2 = job("b2", 2, 2000);
    expect(sortJobs([a1, a2, a3, b1, b2]).map((j) => j.id)).toEqual([
      "b1",
      "b2",
      "a1",
      "a2",
      "a3",
    ]);
  });

  test("does not mutate the input array", () => {
    const a1 = job("a1", 1, 1000);
    const b1 = job("b1", 1, 2000);
    const input = [a1, b1];
    sortJobs(input);
    expect(input.map((j) => j.id)).toEqual(["a1", "b1"]);
  });
});

describe("findOutput", () => {
  const outs = [
    out("gif", "clip1-note.gif", "full"),
    out("gif", "sharable/clip1-note-1024.gif", "sharable"),
  ];

  test("picks the requested tier, not the first output of the kind", () => {
    expect(findOutput(outs, "gif", "sharable")?.name).toBe("sharable/clip1-note-1024.gif");
    expect(findOutput(outs, "gif", "full")?.name).toBe("clip1-note.gif");
  });

  test("an unknown tier matches nothing", () => {
    expect(findOutput(outs, "gif", "nope")).toBeUndefined();
  });

  test("a link without a tier keeps the first match (legacy links)", () => {
    expect(findOutput(outs, "gif")?.name).toBe("clip1-note.gif");
  });

  test("legacy rows infer the tier from the sharable path", () => {
    const legacy = [out("gif", "clip1.gif"), out("gif", "sharable/clip1-512.gif")];
    expect(resolveTier(legacy[0])).toBe("full");
    expect(resolveTier(legacy[1])).toBe("sharable");
    expect(findOutput(legacy, "gif", "sharable")?.name).toBe("sharable/clip1-512.gif");
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

describe("sortJobs tie-break", () => {
  test("equal timestamps order by clip number", () => {
    const c3 = job("c", 3, 1000);
    const c2 = job("b", 2, 1000);
    const c1 = job("a", 1, 1000);
    expect(sortJobs([c3, c2, c1]).map((j) => j.id)).toEqual(["a", "b", "c"]);
  });
});

describe("jobCounts", () => {
  const withStatus = (id: string, status: Job["status"]): Job => ({ ...job(id, 1, 0), status });

  test("splits active, done, and failed", () => {
    expect(jobCounts([])).toEqual({ active: 0, done: 0, failed: 0 });
    expect(
      jobCounts([
        withStatus("q", "queued"),
        withStatus("r", "running"),
        withStatus("d", "done"),
        withStatus("e", "error"),
      ]),
    ).toEqual({ active: 2, done: 1, failed: 1 });
  });

  test("queued and running are active, settled are not", () => {
    expect(isActiveJob(withStatus("q", "queued"))).toBe(true);
    expect(isActiveJob(withStatus("r", "running"))).toBe(true);
    expect(isActiveJob(withStatus("d", "done"))).toBe(false);
    expect(isActiveJob(withStatus("e", "error"))).toBe(false);
  });
});

describe("groupBatches", () => {
  test("splits display-ordered jobs into export batches by createdAt", () => {
    const b = 2000, a = 1000;
    const jobs = sortJobs([job("3", 1, a), job("1", 2, b), job("2", 1, b)]);
    const groups = groupBatches(jobs);
    expect(groups.length).toBe(2);
    expect(groups[0].map((j) => j.id)).toEqual(["2", "1"]);
    expect(groups[1].map((j) => j.id)).toEqual(["3"]);
  });

  test("a single run yields one batch in clip order", () => {
    const jobs = sortJobs([job("2", 2, 5), job("1", 1, 5)]);
    const groups = groupBatches(jobs);
    expect(groups.length).toBe(1);
    expect(groups[0].map((j) => j.id)).toEqual(["1", "2"]);
  });

  test("empty list yields no batches", () => {
    expect(groupBatches([])).toEqual([]);
  });
});

describe("batchTimeLabel", () => {
  test("formats createdAt as zero-padded HH:MM:SS", () => {
    expect(batchTimeLabel(1731000000000)).toMatch(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/);
  });
});
