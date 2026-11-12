import { expect, test } from "bun:test";
import { once } from "../src/lib/ffmpeg";

// `once` backs the encoder probes (nvenc, avif, mp4 encoder choice):
// the probe runs exactly one time per process, and every caller -
// including concurrent ones - shares the same result.

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

test("shares the rejection so a failed probe is not retried", async () => {
  let calls = 0;
  const probe = once(async () => {
    calls++;
    throw new Error("boom");
  });
  await expect(probe()).rejects.toThrow("boom");
  await expect(probe()).rejects.toThrow("boom");
  expect(calls).toBe(1);
});
