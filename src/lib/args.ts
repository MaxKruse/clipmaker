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
 * The mp4 video-encode options block, shared by the single-clip MP4
 * stage and the combined-export concat (same encoder, same bitrate
 * control, so the recipe stays one source of truth).
 */
function mp4VideoEncoderArgs(encoder: Mp4Encoder, kbit: number): string[] {
  if (encoder === "h264_nvenc") {
    return [
      "-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq", "-rc", "vbr",
      "-multipass", "fullres",
      "-b:v", `${kbit}k`,
      "-maxrate", `${Math.round(kbit * 1.5)}k`,
      "-bufsize", `${kbit * 2}k`,
      "-rc-lookahead", "32", "-spatial-aq", "1", "-profile:v", "high",
    ];
  }
  return [
    "-c:v", "libx264", "-preset", "slow",
    "-b:v", `${kbit}k`,
    "-maxrate", `${Math.round(kbit * 1.5)}k`,
    "-bufsize", `${kbit * 2}k`,
    "-profile:v", "high",
  ];
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
  a.push(...mp4VideoEncoderArgs(s.encoder, s.kbit));
  if (s.audio) {
    a.push("-af", "asetpts=PTS-STARTPTS,apad", "-c:a", "aac", "-b:a", "192k", "-ar", "48000");
  } else {
    a.push("-an");
  }
  a.push("-t", fmt(s.dur), "-movflags", "+faststart", s.out);
  return a;
}

/**
 * Animated stage 1: temp FULL-RES mp4 cut straight from the source,
 * re-timed to the anim fps. Both tiers are derived from it: the
 * full-quality output directly, the sharable one downscaled per rung.
 */
export function buildGifStage1Args(s: {
  in: string;
  out: string;
  start: number;
  dur: number;
  fps: number;
  crop: CropBox | null;
}): string[] {
  const vf = [cropFilter(s.crop), `fps=${s.fps}`]
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
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-progress", "pipe:1",
    "-i", s.in,
    "-vf", "scale=256:-2:flags=lanczos,palettegen=stats_mode=full",
    s.out,
  ];
}

/**
 * GIF stage 3: final pass from temp mp4 + palette for one ladder rung.
 * `edge` is the target for the frame's longest edge (`axis`); the full
 * tier passes the frame width with the default axis "w" (a no-op scale).
 */
export function buildGifStage3Args(s: {
  in: string;
  pal: string;
  out: string;
  fps: number;
  edge: number;
  axis?: "w" | "h";
}): string[] {
  const scale = s.axis === "h" ? `scale=-2:${s.edge}:flags=lanczos` : `scale=${s.edge}:-2:flags=lanczos`;
  return [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-progress", "pipe:1",
    "-i", s.in, "-i", s.pal,
    "-lavfi",
    `fps=${s.fps},${scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5`,
    s.out,
  ];
}

export type AvifEncoder = "libsvtav1" | "libaom-av1";

/**
 * AVIF: animated AV1 into the avif (ISOBMFF) muxer, from the full-res
 * temp intermediate. Sharable rungs pass `scaleTo` (the rung edge,
 * targeted at the frame's longest edge per `axis`) and `fps` (rung fps);
 * the full tier encodes as-is. The crf is the size control.
 */
export function buildAvifArgs(s: {
  in: string;
  out: string;
  crf: number;
  encoder: AvifEncoder;
  scaleTo?: number;
  fps?: number;
  axis?: "w" | "h";
}): string[] {
  const vf = [
    s.scaleTo
      ? s.axis === "h"
        ? `scale=-2:${s.scaleTo}:flags=lanczos`
        : `scale=${s.scaleTo}:-2:flags=lanczos`
      : null,
    s.fps ? `fps=${s.fps}` : null,
  ]
    .filter(Boolean)
    .join(",");
  const a = [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-progress", "pipe:1",
    "-i", s.in,
  ];
  if (vf) a.push("-vf", vf);
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

/**
 * Combined-export part: one clip cut from the source, normalized to the
 * group's target size (scale-to-fit + center pad, so different crops in
 * one group never mix resolutions), re-timed to the group fps, with the
 * part's intro/outro fades on both edges (fade length pre-clamped by
 * comboFade). Video is always the fast intermediate encode; audio is the
 * source aac, a silent aac track (parts with audio off in a group that
 * has audio), or nothing.
 */
export function buildComboCutArgs(s: {
  in: string;
  out: string;
  start: number;
  dur: number;
  fps: number;
  crop: CropBox | null;
  targetW: number;
  targetH: number;
  fade: number;
  audio: "source" | "silent" | "none";
}): string[] {
  const fadeOut = Math.max(0, s.dur - s.fade);
  const vf = [
    cropFilter(s.crop),
    `scale=${s.targetW}:${s.targetH}:force_original_aspect_ratio=decrease,pad=${s.targetW}:${s.targetH}:(ow-iw)/2:(oh-ih)/2`,
    `fps=${s.fps}`,
    `fade=t=in:st=0:d=${fmt(s.fade)}`,
    `fade=t=out:st=${fmt(fadeOut)}:d=${fmt(s.fade)}`,
    "setpts=PTS-STARTPTS",
  ]
    .filter(Boolean)
    .join(",");
  const a = [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-progress", "pipe:1",
    "-ss", fmt(s.start), "-i", s.in,
  ];
  if (s.audio === "silent") {
    a.push("-f", "lavfi", "-t", fmt(s.dur), "-i", "anullsrc=r=48000:cl=stereo");
  }
  a.push("-vf", vf);
  a.push("-c:v", "libx264", "-preset", "ultrafast", "-crf", "14", "-pix_fmt", "yuv420p");
  if (s.audio === "source") {
    a.push(
      "-af", `afade=t=in:st=0:d=${fmt(s.fade)},afade=t=out:st=${fmt(fadeOut)}:d=${fmt(s.fade)}`,
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    );
  } else if (s.audio === "silent") {
    a.push("-c:a", "aac", "-b:a", "192k", "-ar", "48000");
  } else {
    a.push("-an");
  }
  a.push("-t", fmt(s.dur), s.out);
  return a;
}

/**
 * Sharable combined tier: the finished highlights mp4 re-encoded at a
 * fixed 30fps, its longest edge scaled to one ladder rung (never
 * upscaled by the caller), CRF so a smaller rung is a smaller file, and
 * a lighter 96k aac track (192k alone would blow the cap on long files).
 * Audio is re-encoded (never copied) so the cap covers the whole file.
 */
export function buildComboShareArgs(s: {
  in: string;
  out: string;
  fps: number;
  edge: number;
  axis: "w" | "h";
  encoder: Mp4Encoder;
  crf: number;
  audio: boolean;
}): string[] {
  const scale =
    s.axis === "h"
      ? `scale=-2:${s.edge}:flags=lanczos`
      : `scale=${s.edge}:-2:flags=lanczos`;
  const a = [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-progress", "pipe:1",
    "-i", s.in,
    "-vf", `${scale},fps=${s.fps},setpts=PTS-STARTPTS`,
  ];
  if (s.encoder === "h264_nvenc") {
    // This encoder's quality-based mode is constqp (no "crf" rc value -
    // -cq there is the constant QP, the same quality knob as x264's crf).
    a.push(
      "-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq", "-rc", "constqp",
      "-cq", String(s.crf), "-profile:v", "high",
    );
  } else {
    a.push("-c:v", "libx264", "-preset", "slow", "-crf", String(s.crf), "-profile:v", "high");
  }
  if (s.audio) a.push("-c:a", "aac", "-b:a", "96k", "-ar", "48000");
  else a.push("-an");
  a.push("-movflags", "+faststart", s.out);
  return a;
}

/**
 * Multi-part sharable tier: stream-concatenate one part's pre-cut
 * segments into the mp4 that feeds the rung ladder. All segments share
 * the group's video stream (one encoder, one size, one fps, and the
 * ultrafast intermediate has no B-frames), so the video is copied; the
 * audio is re-encoded (never copied) so a part mixing source-audio and
 * silent segments lands on one uniform track.
 */
export function buildComboSharePartArgs(s: {
  list: string;
  out: string;
  audio: boolean;
}): string[] {
  const a = [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-progress", "pipe:1",
    "-f", "concat", "-safe", "0", "-i", s.list,
    "-c:v", "copy",
  ];
  if (s.audio) a.push("-c:a", "aac", "-b:a", "192k", "-ar", "48000");
  else a.push("-an");
  a.push("-movflags", "+faststart", s.out);
  return a;
}

/**
 * Concatenate pre-cut combined-export parts (concat demuxer list) into
 * the final mp4, re-encoded with the mp4 recipe (same encoder + bitrate
 * control as a single-clip export). Re-encoding (never stream-copy)
 * keeps the output uniform and gives the fade-filtered parts one clean
 * container.
 */
export function buildConcatArgs(s: {
  list: string;
  out: string;
  audio: boolean;
  encoder: Mp4Encoder;
  kbit: number;
}): string[] {
  const a = [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-progress", "pipe:1",
    "-f", "concat", "-safe", "0", "-i", s.list,
    ...mp4VideoEncoderArgs(s.encoder, Math.round(s.kbit)),
  ];
  if (s.audio) a.push("-c:a", "aac", "-b:a", "192k", "-ar", "48000");
  else a.push("-an");
  a.push("-movflags", "+faststart", s.out);
  return a;
}
