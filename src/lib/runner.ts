import fs from "node:fs";
import path from "node:path";
import {
  buildAvifArgs,
  buildComboShareArgs,
  buildConcatArgs,
  buildComboCutArgs,
  buildGifPaletteArgs,
  buildGifStage1Args,
  buildGifStage3Args,
  buildMp4Args,
  type AvifEncoder,
  type Mp4Encoder,
} from "./args";
import { resolveOutKbit } from "./bitrate";
import {
  comboDuration,
  comboFade,
  comboShareRungs,
  comboTarget,
  COMBO_SHARE_CRF,
  COMBO_SHARE_FPS,
  COMBO_SHARE_MAX_MB,
} from "./combine";
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
import { clipFileName, highlightsFileName } from "./names";
import { OUT_DIR, store, TMP_DIR } from "./store";
import { frameAt } from "./times";
import type { Job, VideoInfo } from "./types";
import { dateFromVideoId } from "./vodDate";

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
    // A failed job keeps no stage: the error row only shows the message.
    job.stage = null;
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
  // Dated ids (a broadcast date in the source name) put every export
  // file in a subfolder of just that date under the video folder.
  const outDir = path.join(OUT_DIR, job.videoId, dateFromVideoId(job.videoId) ?? "");
  fs.mkdirSync(outDir, { recursive: true });
  if (job.clips && job.clips.length > 1) {
    await runCombined(video, job, tmp, outDir);
    return;
  }
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

/**
 * Combined export: same-name clips concatenated into ONE mp4 "highlights"
 * file (mp4 only). Each part is cut from the source at the group's target
 * size and fps with its intro/outro fades, then the parts are
 * concatenated (concat demuxer, re-encoded with the mp4 recipe) with the
 * usual duration check + one retry.
 */
async function runCombined(video: VideoInfo, job: Job, tmp: string, outDir: string) {
  const parts = job.clips!;
  const first = parts[0];
  const target = comboTarget(parts, video);
  // One combined stream: if any part keeps audio (and the source has
  // audio) the file has audio - parts with audio off contribute a silent
  // track, so the concat never mixes streams with/without audio.
  const groupAudio = video.hasAudio && parts.some((c) => c.audio);
  const fps = first.fps;
  const total = comboDuration(parts, video.fps);
  const segs: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const start = frameAt(part.start, video.fps);
    const dur = part.end - start;
    throwIfCancelled(job);
    job.stage = { id: "combo-cut", index: i + 1, total: parts.length };
    const f = path.join(tmp, `seg-${i}.mp4`);
    await runTracked(
      job,
      findBin("ffmpeg"),
      buildComboCutArgs({
        in: video.path,
        out: f,
        start,
        dur,
        fps,
        crop: part.crop,
        targetW: target.w,
        targetH: target.h,
        fade: comboFade(dur),
        audio: groupAudio ? (part.audio ? "source" : "silent") : "none",
      }),
      dur,
    );
    segs.push(f);
  }

  const encoder = await pickEncoder();
  const kbit = resolveOutKbit(video, fps, first.quality);
  // <note>-highlights.mp4, NOT clipN-...: the parts export individually
  // alongside this file (part #N would own clipN-<note>.mp4).
  const outName = highlightsFileName(first.note);
  const outPath = path.join(outDir, outName);
  const concat = () =>
    runTracked(
      job,
      findBin("ffmpeg"),
      buildConcatArgs({
        list: writeConcatList(tmp, "concat.txt", segs),
        out: outPath,
        audio: groupAudio,
        encoder,
        kbit,
      }),
      total,
    );
  job.stage = { id: "mp4-encode", encoder, kbit, fps };
  await concat();
  const warn = await checkDurationOrRetry(outPath, total, fps, job, concat);
  if (warn) job.warning = warn;
  job.outputs.push({ kind: "mp4", name: outName, size: fs.statSync(outPath).size, tier: "full" });

  // Sharable tier: the finished file re-encoded at a fixed 30fps, the
  // longest-edge ladder (768/512/256, capped at the full tier) top-down,
  // first rung under the 48MB cap wins. Unlike the gif/avif ladders this
  // runs AFTER the full tier is on disk, so when even the smallest rung
  // exceeds the cap the full file stays and the tier is skipped with a
  // warning instead of failing the job.
  const rungs = comboShareRungs(target.w, target.h);
  const share = await comboShareRung(job, outPath, total, groupAudio, encoder, tmp, target, rungs);
  if (share) {
    const shareDir = path.join(outDir, "sharable");
    fs.mkdirSync(shareDir, { recursive: true });
    fs.renameSync(share.file, path.join(shareDir, outName));
    const sharePath = path.join(shareDir, outName);
    await checkSharableDuration(sharePath, total, COMBO_SHARE_FPS, job, "mp4");
    job.outputs.push({
      kind: "mp4",
      name: `sharable/${outName}`,
      size: fs.statSync(sharePath).size,
      tier: "sharable",
    });
  } else {
    const smallest = rungs[rungs.length - 1];
    const msg = `sharable highlights exceed the ${COMBO_SHARE_MAX_MB}MB cap even at ${smallest}px/${COMBO_SHARE_FPS}fps - no sharable copy written; shorten the clips or raise the cap`;
    job.warning = job.warning ? `${job.warning} · ${msg}` : msg;
  }
  store.updateJob(job);
}

/**
 * Sharable combined tier: the finished highlights file re-encoded rung by
 * rung (highest quality first) at a fixed 30fps; the first file under the
 * 48MB cap wins. Returns null when every rung exceeds the cap (the caller
 * warns; the full tier is already on disk and stays).
 */
async function comboShareRung(
  job: Job,
  src: string,
  dur: number,
  audio: boolean,
  encoder: Mp4Encoder,
  tmp: string,
  target: { w: number; h: number },
  rungs: number[],
): Promise<{ file: string; rung: number } | null> {
  const maxBytes = COMBO_SHARE_MAX_MB * 1024 * 1024;
  const axis: LongAxis = target.w >= target.h ? "w" : "h";
  for (let i = 0; i < rungs.length; i++) {
    throwIfCancelled(job);
    const edge = rungs[i];
    const f = path.join(tmp, `share-${edge}.mp4`);
    job.stage = { id: "mp4-share-rung", edge, fps: COMBO_SHARE_FPS, index: i + 1, total: rungs.length };
    await runTracked(
      job,
      findBin("ffmpeg"),
      buildComboShareArgs({
        in: src,
        out: f,
        fps: COMBO_SHARE_FPS,
        edge,
        axis,
        encoder,
        crf: COMBO_SHARE_CRF,
        audio,
      }),
      dur,
    );
    if (fs.statSync(f).size <= maxBytes) return { file: f, rung: edge };
    fs.rmSync(f, { force: true });
  }
  return null;
}

/** A concat-demuxer list file pointing at the given segments. */
function writeConcatList(tmp: string, name: string, segs: string[]): string {
  const list = path.join(tmp, name);
  fs.writeFileSync(list, segs.map((s) => `file '${s.replaceAll("'", "'\\''")}'`).join("\n") + "\n");
  return list;
}

async function encodeMp4(video: VideoInfo, job: Job, outDir: string) {
  const clip = job.clip;
  // Floor the cut to the frame displayed at clip.start so the output's
  // first frame is the exact frame a player shows at that sub-second.
  const start = frameAt(clip.start, video.fps);
  const dur = clip.end - start;
  const kbit = resolveOutKbit(video, clip.fps, clip.quality);
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

/** Warn (not fail) when a sharable output's duration misses the
 * request by more than 1.5 frames at the rung's fps. */
async function checkSharableDuration(
  file: string,
  dur: number,
  fps: number,
  job: Job,
  kind: "mp4" | "gif" | "avif",
): Promise<void> {
  const { container } = await streamDurations(file);
  if (Math.abs(container - dur) > 1.5 / fps) {
    job.warning = `${kind} sharable duration ${container.toFixed(2)}s vs requested ${dur.toFixed(2)}s`;
  }
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
 * The intermediate's dimensions and its sharable-tier scale cap/axis,
 * shared by the gif and avif tiers. `cap` is the ladder's longest-edge
 * limit (min of maxEdge and the full tier's edge); `axis` is the axis
 * the ladder scales along (the longer axis, so a portrait crop keeps its
 * height under maxEdge).
 */
function animFrame(
  video: VideoInfo,
  clip: Job["clip"],
): { w: number; h: number; cap: number; axis: LongAxis } {
  const w = clip.crop ? clip.crop.w : video.width;
  const h = clip.crop ? clip.crop.h : video.height;
  const { cap, axis } = sharableCap(clip.anim.maxEdge, w, h);
  return { w, h, cap, axis };
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
  const { fps, maxMB } = clip.anim;
  const { w, cap, axis } = animFrame(video, clip);
  const pal = path.join(tmp, "pal.png");

  throwIfCancelled(job);
  job.stage = { id: "gif-palette" };
  await runTracked(job, findBin("ffmpeg"), buildGifPaletteArgs({ in: inter, out: pal }), dur);

  // Full tier: full resolution at the anim fps, no size cap.
  const fullEdge = evenFloor(w);
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
  const winner = await gifSharableRung(job, inter, pal, cap, maxMB, fps, tmp, dur, axis);
  const shareDir = path.join(outDir, "sharable");
  fs.mkdirSync(shareDir, { recursive: true });
  const fullName = clipFileName(job.clipNo, clip.note, "gif");
  const shareName = `sharable/${clipFileName(job.clipNo, clip.note, "gif", winner.rung.edge)}`;
  fs.renameSync(full, path.join(outDir, fullName));
  fs.renameSync(winner.file, path.join(shareDir, path.basename(shareName)));

  job.stage = { id: "gif-verify" };
  await checkSharableDuration(path.join(shareDir, path.basename(shareName)), dur, winner.rung.fps, job, "gif");
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
  const { fps, maxMB } = clip.anim;
  const { cap, axis } = animFrame(video, clip);
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
  const winner = await avifSharableRung(job, inter, cap, maxMB, fps, encoder, dur, tmp, axis);
  const shareDir = path.join(outDir, "sharable");
  fs.mkdirSync(shareDir, { recursive: true });
  const fullName = clipFileName(job.clipNo, clip.note, "avif");
  fs.renameSync(full, path.join(outDir, fullName));
  fs.renameSync(winner.file, path.join(shareDir, fullName));

  job.stage = { id: "avif-verify" };
  await checkSharableDuration(path.join(shareDir, fullName), dur, winner.rung.fps, job, "avif");
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
