import fs from "node:fs";
import path from "node:path";
import { probeVideo, type ProbeResult } from "./ffmpeg";
import { INGEST_DIR, UPLOADS_DIR, store } from "./store";
import { newId, type VideoInfo } from "./types";

/**
 * Ingest folder sweep: drop a file into INGEST_DIR and the next page load
 * (GET /api/videos runs sweepIngest) probes it, moves it into uploads/ and
 * registers it as a video. Files that cannot be probed are quarantined into
 * INGEST_DIR/failed/ with a .err sidecar explaining why.
 *
 * Server-only module (reads the disk, spawns ffprobe) - the page must never
 * import it; it only consumes the sweep's report through the API response.
 */

export interface IngestReport {
  /** Files that probed as video and were moved into uploads/. */
  ingested: { name: string; id: string }[];
  /** Files that could not be probed (quarantined) or moved (reason kept). */
  rejected: { name: string; reason: string }[];
  /** Files whose size changed during the probe - still being written; the next sweep retries them. */
  pending: string[];
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in test/ingest.test.ts)
// ---------------------------------------------------------------------------

/** Only regular, non-hidden files directly under the ingest root are picked up. */
export function shouldIngest(name: string, isDirectory: boolean): boolean {
  if (isDirectory) return false;
  return name.length > 0 && !name.startsWith(".");
}

/** Collision-free name for the failed/ quarantine folder: cat.mp4, cat (1).mp4, ... */
export function quarantineName(name: string, taken: string[]): string {
  if (!taken.includes(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 1; ; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

/** One-line banner for the page after a sweep; null when the sweep found nothing to report. */
export function ingestNotice(r: IngestReport): string | null {
  const parts: string[] = [];
  if (r.ingested.length) parts.push(`ingested: ${r.ingested.map((v) => v.name).join(", ")}`);
  if (r.rejected.length)
    parts.push(`ingest failed: ${r.rejected.map((x) => `${x.name} - ${x.reason}`).join("; ")}`);
  if (r.pending.length)
    parts.push(`still writing: ${r.pending.join(", ")} - picked up on the next refresh`);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * What a failed rename means for the sweep: the file vanished (skip),
 * another process still owns it - the copy in progress (pending, the
 * next sweep retries it), or a real failure (reject). EXDEV is handled
 * by the caller before classification (copy across volumes).
 */
export function classifyMoveFailure(code: string | undefined): "skip" | "pending" | "reject" {
  if (code === "ENOENT") return "skip";
  if (code === "EBUSY" || code === "EPERM" || code === "EACCES") return "pending";
  return "reject";
}

// ---------------------------------------------------------------------------
// The sweep (server-only)
// ---------------------------------------------------------------------------

let activeSweep: Promise<IngestReport> | null = null;

/**
 * Single-flight: concurrent page loads share one sweep, and a finished
 * sweep is re-run on the next call (a drop after this load waits for the
 * next page load, which is the documented trigger).
 */
export function sweepIngest(): Promise<IngestReport> {
  if (!activeSweep) {
    activeSweep = runSweep().finally(() => {
      activeSweep = null;
    });
  }
  return activeSweep;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function runSweep(): Promise<IngestReport> {
  const report: IngestReport = { ingested: [], rejected: [], pending: [] };
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(INGEST_DIR, { withFileTypes: true });
  } catch {
    return report; // no folder yet
  }
  // Sorted so the report (and auto-select) are deterministic.
  const names = entries
    .filter((e) => shouldIngest(e.name, e.isDirectory()))
    .map((e) => e.name)
    .sort();
  for (const name of names) {
    await ingestOne(path.join(INGEST_DIR, name), name, report);
  }
  return report;
}

async function ingestOne(src: string, name: string, report: IngestReport): Promise<void> {
  let size0: number;
  try {
    size0 = fs.lstatSync(src).size;
  } catch {
    return; // vanished between readdir and stat
  }
  let info: ProbeResult;
  try {
    info = await probeVideo(src);
    if (!info.width) throw new Error("no video stream found");
  } catch (e) {
    quarantine(src, name, errMsg(e), report);
    return;
  }
  let size1: number;
  try {
    size1 = fs.lstatSync(src).size;
  } catch {
    return; // vanished during the probe
  }
  if (size1 !== size0) {
    // Still being written - leave it in place, the next sweep picks it up.
    report.pending.push(name);
    return;
  }
  const id = newId();
  const dir = path.join(UPLOADS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, name);
  try {
    fs.renameSync(src, dest);
  } catch (e) {
    const code =
      typeof e === "object" && e !== null ? (e as NodeJS.ErrnoException).code : undefined;
    if (code === "EXDEV") {
      // The ingest folder may live on another volume (a mount): rename
      // cannot cross volumes, so copy and unlink instead.
      try {
        fs.copyFileSync(src, dest);
        fs.unlinkSync(src);
      } catch (copyErr) {
        fs.rmSync(dir, { recursive: true, force: true });
        report.rejected.push({ name, reason: `move failed: ${errMsg(copyErr)}` });
        return;
      }
    } else {
      fs.rmSync(dir, { recursive: true, force: true });
      const action = classifyMoveFailure(code);
      if (action === "skip") return; // vanished before the move
      if (action === "pending") {
        // Still owned by the writing process (e.g. a copy in progress):
        // leave it in place, the next sweep retries it.
        report.pending.push(name);
        return;
      }
      report.rejected.push({ name, reason: `move failed: ${errMsg(e)}` });
      return;
    }
  }
  const v: VideoInfo = { id, name, path: dest, uploaded: true, ...info };
  store.addVideo(v);
  report.ingested.push({ name, id });
}

/** Move an unprobeable file into failed/ with a .err sidecar; report it either way. */
function quarantine(src: string, name: string, reason: string, report: IngestReport): void {
  const failedDir = path.join(INGEST_DIR, "failed");
  try {
    fs.mkdirSync(failedDir, { recursive: true });
    const destName = quarantineName(name, fs.readdirSync(failedDir));
    fs.renameSync(src, path.join(failedDir, destName));
    fs.writeFileSync(
      path.join(failedDir, `${destName}.err`),
      `${reason}\n${new Date().toISOString()}\n`,
    );
  } catch {
    // Quarantine failed (e.g. the file is locked): it stays in the root
    // and gets retried on the next sweep.
  }
  report.rejected.push({ name, reason });
}
