import { describe, expect, test } from "bun:test";
import { sortJobs } from "../src/lib/jobs";
import { defaultClip, type Job } from "../src/lib/types";

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
