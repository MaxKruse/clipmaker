import { expect, test } from "bun:test";
import {
  classifyMoveFailure,
  ingestNotice,
  quarantineName,
  shouldIngest,
  type IngestReport,
} from "../src/lib/ingest";

// The ingest folder sweep picks up files dropped into INGEST_DIR on the
// next page load. Only regular, non-hidden files directly under the
// ingest root are eligible - subfolders, dotfiles and directories are
// left alone.

test("accepts regular files, including ones with dots in the name", () => {
  expect(shouldIngest("cat.mp4", false)).toBe(true);
  expect(shouldIngest("my.vod-2026.mp4", false)).toBe(true);
});

test("rejects directories", () => {
  expect(shouldIngest("sub", true)).toBe(false);
  expect(shouldIngest("failed", true)).toBe(false);
});

test("rejects dotfiles", () => {
  expect(shouldIngest(".hidden.mp4", false)).toBe(false);
  expect(shouldIngest(".DS_Store", false)).toBe(false);
});

// Quarantined (unprobeable) files land in failed/ and must not clobber
// an earlier rejection with the same name: cat.mp4, cat (1).mp4, ...

test("quarantineName keeps the name when there is no collision", () => {
  expect(quarantineName("cat.mp4", [])).toBe("cat.mp4");
  expect(quarantineName("cat.mp4", ["other.mp4"])).toBe("cat.mp4");
});

test("quarantineName counts up with a space-number suffix", () => {
  expect(quarantineName("cat.mp4", ["cat.mp4"])).toBe("cat (1).mp4");
  expect(quarantineName("cat.mp4", ["cat.mp4", "cat (1).mp4"])).toBe("cat (2).mp4");
});

test("quarantineName splits on the last dot only", () => {
  expect(quarantineName("a.b.c", ["a.b.c"])).toBe("a.b (1).c");
  // No extension (and no leading-dot extension): suffix the whole name.
  expect(quarantineName("README", ["README"])).toBe("README (1)");
  expect(quarantineName(".gitignore", [".gitignore"])).toBe(".gitignore (1)");
});

// ingestNotice is the one-line banner the page shows after a sweep. The
// wording is user-facing - these strings are the contract.

const empty: IngestReport = { ingested: [], rejected: [], pending: [] };

test("ingestNotice is null when the sweep found nothing", () => {
  expect(ingestNotice(empty)).toBe(null);
});

test("ingestNotice lists ingested files", () => {
  expect(
    ingestNotice({ ...empty, ingested: [{ name: "a.mp4", id: "1" }, { name: "b.mp4", id: "2" }] }),
  ).toBe("ingested: a.mp4, b.mp4");
});

test("ingestNotice lists rejected files with their reason", () => {
  expect(
    ingestNotice({ ...empty, rejected: [{ name: "x.mp4", reason: "no video stream found" }] }),
  ).toBe("ingest failed: x.mp4 - no video stream found");
});

test("ingestNotice lists files still being written", () => {
  expect(ingestNotice({ ...empty, pending: ["y.mp4"] })).toBe(
    "still writing: y.mp4 - picked up on the next refresh",
  );
});

test("ingestNotice joins all categories with a middle dot", () => {
  expect(
    ingestNotice({
      ingested: [{ name: "a.mp4", id: "1" }],
      rejected: [{ name: "x.mp4", reason: "bad" }],
      pending: ["y.mp4"],
    }),
  ).toBe(
    "ingested: a.mp4 \u00b7 ingest failed: x.mp4 - bad \u00b7 still writing: y.mp4 - picked up on the next refresh",
  );
});

// A locked file that cannot be renamed is still owned by another process
// (the copy/write in progress) - the next sweep retries it. A vanished
// file is skipped silently; anything else is a real failure.

test("classifyMoveFailure maps errno codes to a sweep action", () => {
  expect(classifyMoveFailure("ENOENT")).toBe("skip");
  expect(classifyMoveFailure("EBUSY")).toBe("pending");
  expect(classifyMoveFailure("EPERM")).toBe("pending");
  expect(classifyMoveFailure("EACCES")).toBe("pending");
  expect(classifyMoveFailure("EPIPE")).toBe("reject");
  expect(classifyMoveFailure(undefined)).toBe("reject");
});
