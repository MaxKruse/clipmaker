import fs from "node:fs";
import path from "node:path";
import {
  buildAvifArgs,
  buildGifPaletteArgs,
  buildGifStage1Args,
  buildGifStage3Args,
  buildMp4Args,
  type AvifEncoder,
  type Mp4Encoder,
} from "./args";
import { resolveSourceKbit, targetVideoKbit } from "./bitrate";
import {
  avifEncoder,
  CancelledError,
  findBin,
  nvencAvailable,
  once,
  runProgress,
  streamDurations,
  type FfmpegHandle,
} from "./ffmpeg";
import {
  avifEmergencyRung,
  buildAvifLadder,
  buildLadder,
  emergencyRung,
  evenFloor,
  sharableCap,
  type AvifRung,
  type LongAxis,
  type Rung,
} from "./ladder";
import { clipFileName } from "./names";
import { OUT_DIR, store, TMP_DIR } from "./store";
import { frameAt } from "./times";
import type { Job, VideoInfo } from "./types";

// Bounded pool: up to CONCURRENCY exports run at once. NVENC handles
// several concurrent GPU encodes, and on a CPU-only box parallel jobs
// only saturate the cores a serial run would have used anyway.
const CONCURRENCY = Math.max(1, Number(process.env.CLIPMAKER_CONCURRENCY) || 2);
const queue: Job[] = [];
const running = new Set<Job>();
// Jobs the user asked to stop. A running job is flagged here (so a cancel
// that lands between ffmpeg stages is caught at the next boundary) and its
// in-flight child is killed via `handles`.
const cancelled = new Set<string>();
const handles = new Map<string, FfmpegHandle>();

/**
 * Encode timeout: at least 60s, and 120x the clip duration - a generous
 * ceiling that only trips on a genuinely hung ffmpeg, freeing the pool.
 */
const encodeTimeout = (sec: number) => Math.max(60_000, Math.ceil(sec * 120_000));

/**
 * Run a tracked encode: registers the job's kill handle (so cancelJob can
 * stop it), reports progress, and times out a hung ffmpeg. Awaits to
 * completion like the old `await runProgress(...)`.
 */
function runTracked(job: Job, bin: string, args: string[], dur: number): Promise<void> {
  const h = runProgress(bin, args, dur, makePctSink(job), encodeTimeout(dur));
  handles.set(job.id, h);
  return h.promise;
}

/** Abort a cancelled job at a stage boundary (no child to kill yet). */
function throwIfCancelled(job: Job) {
  if (cancelled.has(job.id)) throw new CancelledError();
}

/**
 * Cancel a job. Queued jobs are dropped and marked cancelled; running jobs
 * are flagged and their in-flight ffmpeg child is killed. Returns false for
 * an unknown id or a job that has already settled.
 */
export function cancelJob(id: string): boolean {
  const qi = queue.findIndex((j) => j.id === id);
  if (qi >= 0) {
    const job = queue.splice(qi, 1)[0];
    job.status = "error";
    job.stage = null;
    job.error = "cancelled by user";
    store.updateJob(job);
    return true;
  }
  const inFlight = [...running].find((j) => j.id === id);
  if (inFlight && inFlight.status === "running") {
    cancelled.add(id);
    handles.get(id)?.kill();
    return true;
  }
  return false;
}

/** MP4 encoder choice, probed once per process (nvenc when available). */
export const pickEncoder = once(async (): Promise<Mp4Encoder> =>
  (await nvencAvailable()) ? "h264_nvenc" : "libx264",
);

export function enqueue(job: Job) {
  store.addJob(job);
  queue.push(job);
  void pump();
}

function pump() {
  while (queue.length > 0 && running.size < CONCURRENCY) {
    const job = queue.shift()!;
    running.add(job);
    void startJob(job).finally(() => {
      running.delete(job);
      pump();
    });
  }
}

async function startJob(job: Job) {
  try {
    job.status = "running";
    job.pct = 0;
    job.stage = { id: "starting" };
    store.updateJob(job);
    await runJob(job);
    job.status = "done";
    job.pct = 1;
  } catch (e) {
    job.status = "error";
    job.error =
      cancelled.has(job.id) || e instanceof CancelledError
        ? "cancelled by user"
        : e instanceof Error
          ? e.message
          : String(e);
  } finally {
    cancelled.delete(job.id);
    handles.delete(job.id);
    if (job.status !== "error") job.stage = null;
    store.updateJob(job);
    fs.rmSync(path.join(TMP_DIR, job.id), { recursive: true, force: true });
  }
}

/** Per-job progress sink that persists at most twice per second. */
function makePctSink(job: Job) {
  let last = 0;
  return (pct: number) => {
    job.pct = pct;
    const now = Date.now();
    if (now - last > 500) {
      last = now;
      store.updateJob(job);
    }
  };
}

async function runJob(job: Job) {
  const video = store.videos.get(job.videoId);
  if (!video) throw new Error("source video is no longer available");
  throwIfCancelled(job);
  const tmp = path.join(TMP_DIR, job.id);
  fs.mkdirSync(tmp, { recursive: true });
  const outDir = path.join(OUT_DIR, job.videoId);
  fs.mkdirSync(outDir, { recursive: true });
  if (job.clip.formats.includes("mp4")) await encodeMp4(video, job, outDir);
  const wantsGif = job.clip.formats.includes("gif");
  const wantsAvif = job.clip.formats.includes("avif");
  if (wantsGif || wantsAvif) {
    // One <maxEdge>p30 temp cut feeds both pipelines (never gif/avif
    // straight from the VOD); cut once when both are requested.
    const inter = path.join(tmp, "inter.mp4");
    await cutIntermediate(video, job, inter);
    if (wantsGif) await encodeGif(video, job, inter, tmp, outDir);
    if (wantsAvif) await encodeAvif(video, job, inter, tmp, outDir);
  }
}

/** Stage 1: the temp FULL-RES mp4 cut straight from the source, at the anim fps. */
async function cutIntermediate(video: VideoInfo, job: Job, inter: string) {
  const clip = job.clip;
  const start = frameAt(clip.start, video.fps);
  const dur = clip.end - start;
  throwIfCancelled(job);
  job.stage = { id: "anim-cut" };
  await runTracked(
    job,
    findBin("ffmpeg"),
    buildGifStage1Args({ in: video.path, out: inter, start, dur, fps: clip.anim.fps, crop: clip.crop }),
    dur,
  );
}

async function encodeMp4(video: VideoInfo, job: Job, outDir: string) {
  const clip = job.clip;
  // Floor the cut to the frame displayed at clip.start so the output's
  // first frame is the exact frame a player shows at that sub-second.
  const start = frameAt(clip.start, video.fps);
  const dur = clip.end - start;
  const srcKbit = resolveSourceKbit({
    videoKbit: video.videoKbit,
    formatKbit: video.formatKbit,
    audioKbit: video.audioKbit,
  });
  const kbit =
    clip.quality.mode === "manual" && clip.quality.kbit > 0
      ? Math.round(clip.quality.kbit)
      : targetVideoKbit(srcKbit, video.fps, clip.fps);
  const encoder = await pickEncoder();
  throwIfCancelled(job);
  const outName = clipFileName(job.clipNo, clip.note, "mp4");
  const outPath = path.join(outDir, outName);
  const args = () =>
    buildMp4Args({
      in: video.path,
      out: outPath,
      start,
      dur,
      fps: clip.fps,
      kbit,
      audio: clip.audio && video.hasAudio,
      crop: clip.crop,
      encoder,
    });
  job.stage = { id: "mp4-encode", encoder, kbit, fps: clip.fps };
  await runTracked(job, findBin("ffmpeg"), args(), dur);
  const warn = await checkDurationOrRetry(outPath, dur, clip.fps, job, () =>
    runTracked(job, findBin("ffmpeg"), args(), dur),
  );
  if (warn) job.warning = warn;
  job.outputs.push({ kind: "mp4", name: outName, size: fs.statSync(outPath).size });
  store.updateJob(job);
}

async function checkDurationOrRetry(
  file: string,
  dur: number,
  fps: number,
  job: Job,
  rerun: () => Promise<void>,
): Promise<string | undefined> {
  const frame = 1 / fps;
  let d = await streamDurations(file);
  let worst = Math.max(Math.abs(d.container - dur), Math.abs(d.video - dur));
  if (worst > 1.5 * frame) {
    job.stage = { id: "mp4-retry" };
    await rerun();
    d = await streamDurations(file);
    worst = Math.max(Math.abs(d.container - dur), Math.abs(d.video - dur));
  }
  return worst > 1.5 * frame
    ? `duration check: container ${d.container.toFixed(2)}s / video ${d.video.toFixed(2)}s vs requested ${dur.toFixed(2)}s`
    : undefined;
}

/**
 * GIF pipeline on the shared full-res temp cut: one palette (from the
 * cut, never the VOD), then two outputs:
 *  - full tier: full-resolution at the anim fps, no size cap - the
 *    original;
 *  - sharable tier: the quality ladder top-down (edges and fps scaled
 *    to the anim fps), first rung under the cap wins, written into
 *    sharable/.
 */
async function encodeGif(video: VideoInfo, job: Job, inter: string, tmp: string, outDir: string) {
  const clip = job.clip;
  const start = frameAt(clip.start, video.fps);
  const dur = clip.end - start;
  const { fps, maxEdge, maxMB } = clip.anim;
  const pal = path.join(tmp, "pal.png");

  throwIfCancelled(job);
  job.stage = { id: "gif-palette" };
  await runTracked(job, findBin("ffmpeg"), buildGifPaletteArgs({ in: inter, out: pal }), dur);

  // Full tier: full resolution at the anim fps, no size cap.
  const fullEdge = evenFloor(clip.crop ? clip.crop.w : video.width);
  const full = path.join(tmp, "gif-full.gif");
  job.stage = { id: "gif-full", edge: fullEdge, fps };
  await runTracked(
    job,
    findBin("ffmpeg"),
    buildGifStage3Args({ in: inter, pal, out: full, fps, edge: fullEdge }),
    dur,
  );

  // The ladder never upscales: capped at the full tier's LONGEST edge,
  // and scaled on that axis, so a portrait crop's height stays under
  // maxEdge too; a crop (or source) smaller than maxEdge keeps what it has.
  const { cap, axis } = sharableCap(maxEdge, clip.crop ? clip.crop.w : video.width, clip.crop ? clip.crop.h : video.height);
  const winner = await gifSharableRung(job, inter, pal, cap, maxMB, fps, tmp, dur, axis);
  const shareDir = path.join(outDir, "sharable");
  fs.mkdirSync(shareDir, { recursive: true });
  const fullName = clipFileName(job.clipNo, clip.note, "gif");
  const shareName = `sharable/${clipFileName(job.clipNo, clip.note, "gif", winner.rung.edge)}`;
  fs.renameSync(full, path.join(outDir, fullName));
  fs.renameSync(winner.file, path.join(shareDir, path.basename(shareName)));

  job.stage = { id: "gif-verify" };
  const { container } = await streamDurations(path.join(shareDir, path.basename(shareName)));
  if (Math.abs(container - dur) > 1.5 / winner.rung.fps) {
    job.warning = `gif sharable duration ${container.toFixed(2)}s vs requested ${dur.toFixed(2)}s`;
  }
  job.outputs.push(
    { kind: "gif", name: fullName, size: fs.statSync(path.join(outDir, fullName)).size, tier: "full" },
    { kind: "gif", name: shareName, size: fs.statSync(path.join(shareDir, path.basename(shareName))).size, tier: "sharable" },
  );
  store.updateJob(job);
}

/** Sharable-tier GIF: the quality ladder top-down, first rung under the cap. */
async function gifSharableRung(
  job: Job, inter: string, pal: string, maxEdge: number, maxMB: number, fps: number, tmp: string, dur: number, axis: LongAxis,
): Promise<{ file: string; rung: Rung }> {
  const ladder = buildLadder(maxEdge, fps);
  const maxBytes = maxMB * 1024 * 1024;
  for (let i = 0; i < ladder.length; i++) {
    throwIfCancelled(job);
    const rung = ladder[i];
    const f = path.join(tmp, `gif-${rung.edge}-${rung.fps}.gif`);
    job.stage = { id: "gif-rung", edge: rung.edge, fps: rung.fps, index: i + 1, total: ladder.length };
    await runTracked(job, findBin("ffmpeg"), buildGifStage3Args({ in: inter, pal, out: f, fps: rung.fps, edge: rung.edge, axis }), dur);
    if (fs.statSync(f).size <= maxBytes) return { file: f, rung };
    fs.rmSync(f, { force: true });
  }
  const e = emergencyRung(maxEdge, fps);
  const f = path.join(tmp, "gif-emergency.gif");
  job.stage = { id: "gif-emergency", edge: e.edge, fps: e.fps };
  throwIfCancelled(job);
  await runTracked(job, findBin("ffmpeg"), buildGifStage3Args({ in: inter, pal, out: f, fps: e.fps, edge: e.edge, axis }), dur);
  if (fs.statSync(f).size > maxBytes) {
    fs.rmSync(f, { force: true });
    throw new Error(`gif exceeds the ${maxMB}MB cap even at ${e.edge}px/${e.fps}fps - shorten the clip or raise the cap`);
  }
  return { file: f, rung: e };
}

/**
 * AVIF pipeline on the shared full-res temp cut: two outputs:
 *  - full tier: full resolution at crf30, no size cap;
 *  - sharable tier: the 3-axis ladder (fps, edge, crf) top-down, first
 *    rung under the cap wins, written into sharable/.
 * Slower than the GIF path but far better quality per byte.
 */
async function encodeAvif(video: VideoInfo, job: Job, inter: string, tmp: string, outDir: string) {
  const clip = job.clip;
  const start = frameAt(clip.start, video.fps);
  const dur = clip.end - start;
  const { fps, maxMB, maxEdge } = clip.anim;
  const encoder = await avifEncoder();
  if (!encoder) {
    throw new Error("this ffmpeg build has no AV1 encoder (needs libsvtav1 or libaom-av1) - re-export as mp4/gif");
  }
  throwIfCancelled(job);

  // Full tier: full resolution at crf30, no size cap (the sharable
  // ladder's CRF range 25-36 is separate).
  const fullCrf = 30;
  const full = path.join(tmp, "avif-full.avif");
  job.stage = { id: "avif-full", encoder, crf: fullCrf };
  await runTracked(
    job,
    findBin("ffmpeg"),
    buildAvifArgs({ in: inter, out: full, crf: fullCrf, encoder }),
    dur,
  );

  // The ladder never upscales: capped at the full tier's LONGEST edge,
  // and scaled on that axis, so a portrait crop's height stays under
  // maxEdge too; a crop (or source) smaller than maxEdge keeps what it has.
  const { cap, axis } = sharableCap(maxEdge, clip.crop ? clip.crop.w : video.width, clip.crop ? clip.crop.h : video.height);
  const winner = await avifSharableRung(job, inter, cap, maxMB, fps, encoder, dur, tmp, axis);
  const shareDir = path.join(outDir, "sharable");
  fs.mkdirSync(shareDir, { recursive: true });
  const fullName = clipFileName(job.clipNo, clip.note, "avif");
  fs.renameSync(full, path.join(outDir, fullName));
  fs.renameSync(winner.file, path.join(shareDir, fullName));

  job.stage = { id: "avif-verify" };
  const { container } = await streamDurations(path.join(shareDir, fullName));
  if (Math.abs(container - dur) > 1.5 / winner.rung.fps) {
    job.warning = `avif sharable duration ${container.toFixed(2)}s vs requested ${dur.toFixed(2)}s`;
  }
  job.outputs.push(
    { kind: "avif", name: fullName, size: fs.statSync(path.join(outDir, fullName)).size, tier: "full" },
    { kind: "avif", name: `sharable/${fullName}`, size: fs.statSync(path.join(shareDir, fullName)).size, tier: "sharable" },
  );
  store.updateJob(job);
}

/** Sharable-tier AVIF: the 3-axis ladder (fps, edge, crf) top-down, first rung under the cap. */
async function avifSharableRung(
  job: Job, inter: string, maxEdge: number, maxMB: number, fps: number,
  encoder: AvifEncoder, dur: number, tmp: string, axis: LongAxis,
): Promise<{ file: string; rung: AvifRung }> {
  const maxBytes = maxMB * 1024 * 1024;
  const ladder = buildAvifLadder(maxEdge, fps);
  for (let i = 0; i < ladder.length; i++) {
    throwIfCancelled(job);
    const rung = ladder[i];
    const f = path.join(tmp, `avif-${rung.crf}-${rung.edge}-${rung.fps}.avif`);
    job.stage = { id: "avif-rung", crf: rung.crf, edge: rung.edge, fps: rung.fps, index: i + 1, total: ladder.length };
    await runTracked(
      job,
      findBin("ffmpeg"),
      buildAvifArgs({ in: inter, out: f, crf: rung.crf, encoder, scaleTo: rung.edge, fps: rung.fps, axis }),
      dur,
    );
    if (fs.statSync(f).size <= maxBytes) return { file: f, rung };
    fs.rmSync(f, { force: true });
  }
  const e = avifEmergencyRung(maxEdge, fps);
  const f = path.join(tmp, "avif-emergency.avif");
  job.stage = { id: "avif-emergency", crf: e.crf, edge: e.edge, fps: e.fps };
  throwIfCancelled(job);
  await runTracked(
    job,
    findBin("ffmpeg"),
    buildAvifArgs({ in: inter, out: f, crf: e.crf, encoder, scaleTo: e.edge, fps: e.fps, axis }),
    dur,
  );
  if (fs.statSync(f).size > maxBytes) {
    fs.rmSync(f, { force: true });
    throw new Error(`avif exceeds the ${maxMB}MB cap even at crf${e.crf} ${e.edge}p${e.fps} - shorten the clip or raise the cap`);
  }
  return { file: f, rung: e };
}
