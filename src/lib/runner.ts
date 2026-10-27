import fs from "node:fs";
import path from "node:path";
import {
  buildGifPaletteArgs,
  buildGifStage1Args,
  buildGifStage3Args,
  buildMp4Args,
  type Mp4Encoder,
} from "./args";
import { resolveSourceKbit, targetVideoKbit } from "./bitrate";
import { findBin, nvencAvailable, run, runProgress, streamDurations } from "./ffmpeg";
import { buildLadder, emergencyRung, type Rung } from "./ladder";
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
  if (job.clip.formats.includes("gif")) await encodeGif(video, job, tmp, outDir);
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
 * GIF pipeline: temp <maxEdge>p30 mp4 first (never gif-from-VOD), then
 * palette, then the quality ladder top-down; first rung under the cap wins.
 */
async function encodeGif(video: VideoInfo, job: Job, tmp: string, outDir: string) {
  const clip = job.clip;
  const start = frameAt(clip.start, video.fps);
  const dur = clip.end - start;
  const { maxEdge, maxMB } = clip.gif;
  const inter = path.join(tmp, "inter.mp4");
  const pal = path.join(tmp, "pal.png");

  job.stage = "gif: cut";
  await runProgress(
    findBin("ffmpeg"),
    buildGifStage1Args({ in: video.path, out: inter, start, dur, maxEdge, crop: clip.crop }),
    dur,
    makePctSink(job),
  );

  job.stage = "gif: palette";
  await run(findBin("ffmpeg"), buildGifPaletteArgs({ in: inter, out: pal }));

  const ladder = buildLadder(maxEdge);
  const maxBytes = maxMB * 1024 * 1024;
  let winner: { rung: Rung; file: string } | null = null;
  for (let i = 0; i < ladder.length; i++) {
    const rung = ladder[i];
    const f = path.join(tmp, `gif-${rung.edge}-${rung.fps}.gif`);
    job.stage = `gif: ${rung.edge}p${rung.fps} (${i + 1}/${ladder.length})`;
    await run(findBin("ffmpeg"), buildGifStage3Args({ in: inter, pal, out: f, fps: rung.fps, edge: rung.edge }));
    const size = fs.statSync(f).size;
    if (size <= maxBytes) {
      winner = { rung, file: f };
      break;
    }
    fs.rmSync(f, { force: true });
  }

  if (!winner) {
    const e = emergencyRung(maxEdge);
    const f = path.join(tmp, "gif-emergency.gif");
    job.stage = `gif: ${e.edge}p${e.fps} (emergency)`;
    await run(findBin("ffmpeg"), buildGifStage3Args({ in: inter, pal, out: f, fps: e.fps, edge: e.edge }));
    if (fs.statSync(f).size > maxBytes) {
      fs.rmSync(f, { force: true });
      throw new Error(
        `gif exceeds the ${maxMB}MB cap even at ${e.edge}px/25fps - shorten the clip or raise the cap`,
      );
    }
    winner = { rung: e, file: f };
  }

  const outName = clipFileName(job.clipNo, clip.note, "gif", winner.rung.edge);
  const outPath = path.join(outDir, outName);
  fs.renameSync(winner.file, outPath);

  job.stage = "gif: verify";
  const { container } = await streamDurations(outPath);
  const worst = Math.abs(container - dur);
  if (worst > 1.5 / winner.rung.fps) {
    job.warning = `gif duration ${container.toFixed(2)}s vs requested ${dur.toFixed(2)}s`;
  }
  job.outputs.push({ kind: "gif", name: outName, size: fs.statSync(outPath).size });
  store.updateJob(job);
}
