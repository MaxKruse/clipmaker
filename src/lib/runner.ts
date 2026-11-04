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
import { avifEncoder, findBin, nvencAvailable, run, runProgress, streamDurations } from "./ffmpeg";
import { avifEmergencyCrf, buildAvifCrfLadder, buildLadder, emergencyRung, evenFloor, type Rung } from "./ladder";
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
let encoderPromise: Promise<Mp4Encoder> | null = null;

export function pickEncoder(): Promise<Mp4Encoder> {
  encoderPromise ??= nvencAvailable().then((ok) => (ok ? "h264_nvenc" : "libx264"));
  return encoderPromise;
}

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
    job.stage = "starting";
    store.updateJob(job);
    await runJob(job);
    job.status = "done";
    job.pct = 1;
  } catch (e) {
    job.status = "error";
    job.error = e instanceof Error ? e.message : String(e);
  } finally {
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
  job.stage = "anim: cut (full-res)";
  await runProgress(
    findBin("ffmpeg"),
    buildGifStage1Args({ in: video.path, out: inter, start, dur, fps: clip.anim.fps, crop: clip.crop }),
    dur,
    makePctSink(job),
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
  job.stage = `mp4 ${encoder} ${kbit}k ${clip.fps}fps`;
  await runProgress(findBin("ffmpeg"), args(), dur, makePctSink(job));
  const warn = await checkDurationOrRetry(outPath, dur, clip.fps, job, () =>
    runProgress(findBin("ffmpeg"), args(), dur, makePctSink(job)),
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
    job.stage = `mp4 retry`;
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

  job.stage = "gif: palette";
  await run(findBin("ffmpeg"), buildGifPaletteArgs({ in: inter, out: pal }));

  // Full tier: full resolution at the anim fps, no size cap.
  const fullEdge = evenFloor(clip.crop ? clip.crop.w : video.width);
  const full = path.join(tmp, "gif-full.gif");
  job.stage = `gif: full ${fullEdge}p${fps}`;
  await runProgress(
    findBin("ffmpeg"),
    buildGifStage3Args({ in: inter, pal, out: full, fps, edge: fullEdge }),
    dur,
    makePctSink(job),
  );

  // The ladder never upscales: capped at the full tier's edge, so a crop
  // (or source) narrower than maxEdge just keeps the best it has.
  const winner = await gifSharableRung(job, inter, pal, Math.min(maxEdge, fullEdge), maxMB, fps, tmp);
  const shareDir = path.join(outDir, "sharable");
  fs.mkdirSync(shareDir, { recursive: true });
  const fullName = clipFileName(job.clipNo, clip.note, "gif");
  const shareName = `sharable/${clipFileName(job.clipNo, clip.note, "gif", winner.rung.edge)}`;
  fs.renameSync(full, path.join(outDir, fullName));
  fs.renameSync(winner.file, path.join(shareDir, path.basename(shareName)));

  job.stage = "gif: verify";
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
  job: Job, inter: string, pal: string, maxEdge: number, maxMB: number, fps: number, tmp: string,
): Promise<{ file: string; rung: Rung }> {
  const ladder = buildLadder(maxEdge, fps);
  const maxBytes = maxMB * 1024 * 1024;
  for (let i = 0; i < ladder.length; i++) {
    const rung = ladder[i];
    const f = path.join(tmp, `gif-${rung.edge}-${rung.fps}.gif`);
    job.stage = `gif: sharable ${rung.edge}p${rung.fps} (${i + 1}/${ladder.length})`;
    await run(findBin("ffmpeg"), buildGifStage3Args({ in: inter, pal, out: f, fps: rung.fps, edge: rung.edge }));
    if (fs.statSync(f).size <= maxBytes) return { file: f, rung };
    fs.rmSync(f, { force: true });
  }
  const e = emergencyRung(maxEdge, fps);
  const f = path.join(tmp, "gif-emergency.gif");
  job.stage = `gif: sharable ${e.edge}p${e.fps} (emergency)`;
  await run(findBin("ffmpeg"), buildGifStage3Args({ in: inter, pal, out: f, fps: e.fps, edge: e.edge }));
  if (fs.statSync(f).size > maxBytes) {
    fs.rmSync(f, { force: true });
    throw new Error(`gif exceeds the ${maxMB}MB cap even at ${e.edge}px/${e.fps}fps - shorten the clip or raise the cap`);
  }
  return { file: f, rung: e };
}

/**
 * AVIF pipeline on the shared full-res temp cut: two outputs:
 *  - full tier: full resolution at the best CRF, no size cap;
 *  - sharable tier: scaled to the max edge, CRF ladder top-down, first
 *    rung under the cap wins, written into sharable/.
 * Slower than the GIF path but far better quality per byte.
 */
async function encodeAvif(video: VideoInfo, job: Job, inter: string, tmp: string, outDir: string) {
  const clip = job.clip;
  const start = frameAt(clip.start, video.fps);
  const dur = clip.end - start;
  const { maxMB, maxEdge } = clip.anim;
  const encoder = await avifEncoder();
  if (!encoder) {
    throw new Error("this ffmpeg build has no AV1 encoder (needs libsvtav1 or libaom-av1) - re-export as mp4/gif");
  }

  // Full tier: full resolution at the top CRF, no size cap.
  const fullCrf = buildAvifCrfLadder()[0];
  const full = path.join(tmp, "avif-full.avif");
  job.stage = `avif: full ${encoder} crf${fullCrf}`;
  await runProgress(
    findBin("ffmpeg"),
    buildAvifArgs({ in: inter, out: full, crf: fullCrf, encoder }),
    dur,
    makePctSink(job),
  );

  const winner = await avifSharableCrf(job, inter, maxEdge, maxMB, encoder, dur, tmp);
  const shareDir = path.join(outDir, "sharable");
  fs.mkdirSync(shareDir, { recursive: true });
  const fullName = clipFileName(job.clipNo, clip.note, "avif");
  fs.renameSync(full, path.join(outDir, fullName));
  fs.renameSync(winner.file, path.join(shareDir, fullName));

  job.stage = "avif: verify";
  const { container } = await streamDurations(path.join(shareDir, fullName));
  if (Math.abs(container - dur) > 1.5 / 30) {
    job.warning = `avif sharable duration ${container.toFixed(2)}s vs requested ${dur.toFixed(2)}s`;
  }
  job.outputs.push(
    { kind: "avif", name: fullName, size: fs.statSync(path.join(outDir, fullName)).size, tier: "full" },
    { kind: "avif", name: `sharable/${fullName}`, size: fs.statSync(path.join(shareDir, fullName)).size, tier: "sharable" },
  );
  store.updateJob(job);
}

/** Sharable-tier AVIF: CRF ladder at the max edge, first rung under the cap. */
async function avifSharableCrf(
  job: Job, inter: string, maxEdge: number, maxMB: number, encoder: AvifEncoder, dur: number, tmp: string,
): Promise<{ file: string; crf: number }> {
  const maxBytes = maxMB * 1024 * 1024;
  const ladder = buildAvifCrfLadder();
  for (let i = 0; i < ladder.length; i++) {
    const crf = ladder[i];
    const f = path.join(tmp, `avif-crf${crf}.avif`);
    job.stage = `avif: sharable crf${crf} (${i + 1}/${ladder.length})`;
    await runProgress(
      findBin("ffmpeg"),
      buildAvifArgs({ in: inter, out: f, crf, encoder, scaleTo: maxEdge }),
      dur,
      makePctSink(job),
    );
    if (fs.statSync(f).size <= maxBytes) return { file: f, crf };
    fs.rmSync(f, { force: true });
  }
  const crf = avifEmergencyCrf();
  const f = path.join(tmp, "avif-emergency.avif");
  job.stage = `avif: sharable crf${crf} (emergency)`;
  await runProgress(
    findBin("ffmpeg"),
    buildAvifArgs({ in: inter, out: f, crf, encoder, scaleTo: maxEdge }),
    dur,
    makePctSink(job),
  );
  if (fs.statSync(f).size > maxBytes) {
    fs.rmSync(f, { force: true });
    throw new Error(`avif exceeds the ${maxMB}MB cap even at crf${crf} - shorten the clip or raise the cap`);
  }
  return { file: f, crf };
}
