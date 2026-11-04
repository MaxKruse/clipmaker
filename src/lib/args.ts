import { cropFilter, type CropBox } from "./crop";

/** Compact seconds for ffmpeg options: 12.5, 7.25, 30 (no trailing zeros). */
function fmt(n: number): string {
  return String(Number(n.toFixed(3)));
}

export type Mp4Encoder = "h264_nvenc" | "libx264";

export interface Mp4Args {
  in: string;
  out: string;
  start: number;
  dur: number;
  fps: number;
  kbit: number;
  audio: boolean;
  crop: CropBox | null;
  encoder: Mp4Encoder;
}

/**
 * Frame-accurate mp4 cut: everything re-encoded, audio padded with apad,
 * output -t does the final cut. Never stream-copied (the "empty tail" bug).
 */
export function buildMp4Args(s: Mp4Args): string[] {
  const vf = [cropFilter(s.crop), `fps=${s.fps}`, "setpts=PTS-STARTPTS"]
    .filter(Boolean)
    .join(",");
  const a = [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-progress", "pipe:1",
    "-ss", fmt(s.start), "-i", s.in,
    "-vf", vf,
  ];
  if (s.encoder === "h264_nvenc") {
    a.push(
      "-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq", "-rc", "vbr",
      "-multipass", "fullres",
      "-b:v", `${s.kbit}k`,
      "-maxrate", `${Math.round(s.kbit * 1.5)}k`,
      "-bufsize", `${s.kbit * 2}k`,
      "-rc-lookahead", "32", "-spatial-aq", "1", "-profile:v", "high",
    );
  } else {
    a.push(
      "-c:v", "libx264", "-preset", "slow",
      "-b:v", `${s.kbit}k`,
      "-maxrate", `${Math.round(s.kbit * 1.5)}k`,
      "-bufsize", `${s.kbit * 2}k`,
      "-profile:v", "high",
    );
  }
  if (s.audio) {
    a.push("-af", "asetpts=PTS-STARTPTS,apad", "-c:a", "aac", "-b:a", "192k", "-ar", "48000");
  } else {
    a.push("-an");
  }
  a.push("-t", fmt(s.dur), "-movflags", "+faststart", s.out);
  return a;
}

/**
 * Animated stage 1: temp FULL-RES 30fps mp4 cut straight from the
 * source. Both tiers are derived from it: the full-quality output
 * directly, the sharable one downscaled per rung.
 */
export function buildGifStage1Args(s: {
  in: string;
  out: string;
  start: number;
  dur: number;
  crop: CropBox | null;
}): string[] {
  const vf = [cropFilter(s.crop), "fps=30"]
    .filter(Boolean)
    .join(",");
  return [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-progress", "pipe:1",
    "-ss", fmt(s.start), "-i", s.in, "-t", fmt(s.dur),
    "-vf", vf,
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "14", "-pix_fmt", "yuv420p",
    "-an", s.out,
  ];
}

/** GIF stage 2: per-clip palette from the temp mp4 (never the VOD). */
export function buildGifPaletteArgs(s: { in: string; out: string }): string[] {
  return [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-i", s.in,
    "-vf", "scale=256:-2:flags=lanczos,palettegen=stats_mode=full",
    s.out,
  ];
}

/** GIF stage 3: final pass from temp mp4 + palette for one ladder rung. */
export function buildGifStage3Args(s: {
  in: string;
  pal: string;
  out: string;
  fps: number;
  edge: number;
}): string[] {
  return [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-i", s.in, "-i", s.pal,
    "-lavfi",
    `fps=${s.fps},scale=${s.edge}:-2:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5`,
    s.out,
  ];
}

export type AvifEncoder = "libsvtav1" | "libaom-av1";

/**
 * AVIF: animated AV1 into the avif (ISOBMFF) muxer, from the full-res
 * temp intermediate. `scaleTo` (sharable tier) downscales to the max
 * edge; the full tier encodes as-is. The crf is the size control.
 */
export function buildAvifArgs(s: {
  in: string;
  out: string;
  crf: number;
  encoder: AvifEncoder;
  scaleTo?: number;
}): string[] {
  const a = [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-progress", "pipe:1",
    "-i", s.in,
  ];
  if (s.scaleTo) a.push("-vf", `scale=${s.scaleTo}:-2:flags=lanczos`);
  a.push("-c:v", s.encoder, "-crf", String(s.crf), "-pix_fmt", "yuv420p", "-an", s.out);
  return a;
}

/** Single-frame jpeg for the crop preview. */
export function buildPreviewArgs(s: {
  in: string;
  out: string;
  time: number;
  maxW: number;
  crop: CropBox | null;
}): string[] {
  const vf = [cropFilter(s.crop), `scale=${s.maxW}:-2:flags=lanczos`]
    .filter(Boolean)
    .join(",");
  return [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-ss", fmt(s.time), "-i", s.in, "-frames:v", "1",
    "-vf", vf,
    s.out,
  ];
}
