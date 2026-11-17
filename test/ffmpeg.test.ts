import { expect, test } from "bun:test";
import { once } from "../src/lib/ffmpeg";

// `once` backs the encoder probes (nvenc, avif, mp4 encoder choice): one
// in-flight attempt shared by concurrent callers, retried after a failure.

test("runs the probe exactly once and shares the result", async () => {
  let calls = 0;
  const probe = once(async () => {
    calls++;
    return 42;
  });
  const [a, b, c] = await Promise.all([probe(), probe(), probe()]);
  expect(a).toBe(42);
  expect(b).toBe(42);
  expect(c).toBe(42);
  expect(calls).toBe(1);
});

test("a failed probe is not cached: the next call retries", async () => {
  let calls = 0;
  const probe = once(async () => {
    calls++;
    if (calls === 1) throw new Error("boom");
    return 42;
  });
  await expect(probe()).rejects.toThrow("boom");
  expect(await probe()).toBe(42);
  expect(calls).toBe(2);
});
