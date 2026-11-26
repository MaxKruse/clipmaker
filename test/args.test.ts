import { describe, expect, test } from "bun:test";
import {
  buildAvifArgs,
  buildComboShareArgs,
  buildComboShareSectionArgs,
  buildConcatArgs,
  buildComboCutArgs,
  buildGifPaletteArgs,
  buildGifStage1Args,
  buildGifStage3Args,
  buildMp4Args,
  buildPreviewArgs,
} from "../src/lib/args";

const CROP = { x: 0, y: 0, w: 1280, h: 720, angle: 0 };

describe("buildMp4Args (nvenc, audio, crop)", () => {
  test("matches the frame-accurate re-encode recipe", () => {
    expect(
      buildMp4Args({
        in: "in.mp4",
        out: "out.mp4",
        start: 12.5,
        dur: 7.25,
        fps: 30,
        kbit: 2500,
        audio: true,
        crop: CROP,
        encoder: "h264_nvenc",
      }),
    ).toEqual([
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-progress", "pipe:1",
      "-ss", "12.5", "-i", "in.mp4",
      "-vf", "crop=1280:720:0:0,fps=30,setpts=PTS-STARTPTS",
      "-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq", "-rc", "vbr",
      "-multipass", "fullres",
      "-b:v", "2500k", "-maxrate", "3750k", "-bufsize", "5000k",
      "-rc-lookahead", "32", "-spatial-aq", "1", "-profile:v", "high",
      "-af", "asetpts=PTS-STARTPTS,apad", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
      "-t", "7.25", "-movflags", "+faststart", "out.mp4",
    ]);
  });

  test("no crop -> plain fps+setpts filter", () => {
    const args = buildMp4Args({
      in: "in.mp4", out: "out.mp4", start: 0, dur: 10, fps: 25,
      kbit: 2500, audio: true, crop: null, encoder: "h264_nvenc",
    });
    expect(args).toContain("-vf");
    expect(args[args.indexOf("-vf") + 1]).toBe("fps=25,setpts=PTS-STARTPTS");
  });

  test("tilted crop -> the straighten recipe is prepended before fps", () => {
    const args = buildMp4Args({
      in: "in.mp4", out: "out.mp4", start: 0, dur: 10, fps: 30,
      kbit: 2500, audio: false, crop: { x: 460, y: 180, w: 1000, h: 540, angle: 5 }, encoder: "h264_nvenc",
    });
    const vf = args[args.indexOf("-vf") + 1];
    expect(vf.startsWith("crop=1044:626:438:136,rotate=-0.08726")).toBe(true);
    expect(vf.endsWith(",crop=1000:540:22:42,fps=30,setpts=PTS-STARTPTS")).toBe(true);
  });

  test("audio off -> -an, no aac chain", () => {
    const args = buildMp4Args({
      in: "in.mp4", out: "out.mp4", start: 0, dur: 10, fps: 30,
      kbit: 2500, audio: false, crop: null, encoder: "h264_nvenc",
    });
    expect(args).toContain("-an");
    expect(args).not.toContain("-c:a");
    expect(args).not.toContain("-af");
  });

  test("x264 fallback encoder", () => {
    const args = buildMp4Args({
      in: "in.mp4", out: "out.mp4", start: 0, dur: 10, fps: 30,
      kbit: 1234, audio: true, crop: null, encoder: "libx264",
    });
    const iv = args.indexOf("-c:v");
    expect(args.slice(iv, iv + 10)).toEqual([
      "-c:v", "libx264", "-preset", "slow",
      "-b:v", "1234k", "-maxrate", "1851k", "-bufsize", "2468k",
    ]);
    expect(args).not.toContain("-rc-lookahead");
  });

  test("audio on a silent source still pads audio", () => {
    const args = buildMp4Args({
      in: "in.mp4", out: "out.mp4", start: 1, dur: 5, fps: 30,
      kbit: 1000, audio: true, crop: null, encoder: "libx264",
    });
    expect(args).toContain("asetpts=PTS-STARTPTS,apad");
  });
});

describe("buildGifStage1Args", () => {
  test("cut a FULL-RES temp mp4 from source with crop (no downscale)", () => {
    expect(
      buildGifStage1Args({
        in: "vod.mp4", out: "inter.mp4", start: 30, dur: 10, crop: CROP, fps: 30,
      }),
    ).toEqual([
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-progress", "pipe:1",
      "-ss", "30", "-i", "vod.mp4", "-t", "10",
      "-vf", "crop=1280:720:0:0,fps=30",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "14", "-pix_fmt", "yuv420p",
      "-an", "inter.mp4",
    ]);
  });

  test("no crop -> fps only", () => {
    const args = buildGifStage1Args({ in: "a.mp4", out: "b.mp4", start: 0, dur: 5, crop: null, fps: 30 });
    expect(args[args.indexOf("-vf") + 1]).toBe("fps=30");
    expect(args).not.toContain("scale");
  });

  test("fps flows into the -vf chain", () => {
    const args = buildGifStage1Args({ in: "a.mp4", out: "b.mp4", start: 0, dur: 5, crop: null, fps: 60 });
    expect(args[args.indexOf("-vf") + 1]).toBe("fps=60");
  });
});

describe("buildGifPaletteArgs", () => {
  test("palettegen from the temp mp4 only", () => {
    expect(buildGifPaletteArgs({ in: "inter.mp4", out: "pal.png" })).toEqual([
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-progress", "pipe:1",
      "-i", "inter.mp4",
      "-vf", "scale=256:-2:flags=lanczos,palettegen=stats_mode=full",
      "pal.png",
    ]);
  });
});

describe("buildGifStage3Args", () => {
  test("paletteuse with bayer dither", () => {
    expect(
      buildGifStage3Args({ in: "inter.mp4", pal: "pal.png", out: "out.gif", fps: 25, edge: 512 }),
    ).toEqual([
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-progress", "pipe:1",
      "-i", "inter.mp4", "-i", "pal.png",
      "-lavfi", "fps=25,scale=512:-2:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5",
      "out.gif",
    ]);
  });

  test("axis h scales the height (portrait crop): the longest edge is the target", () => {
    expect(
      buildGifStage3Args({ in: "inter.mp4", pal: "pal.png", out: "out.gif", fps: 25, edge: 512, axis: "h" }),
    ).toEqual([
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-progress", "pipe:1",
      "-i", "inter.mp4", "-i", "pal.png",
      "-lavfi", "fps=25,scale=-2:512:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5",
      "out.gif",
    ]);
  });
});

describe("buildPreviewArgs", () => {
  test("single cropped frame scaled down", () => {
    expect(
      buildPreviewArgs({ in: "vod.mp4", out: "prev.jpg", time: 5.25, maxW: 480, crop: CROP }),
    ).toEqual([
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-ss", "5.25", "-i", "vod.mp4", "-frames:v", "1",
      "-vf", "crop=1280:720:0:0,scale=480:-2:flags=lanczos",
      "prev.jpg",
    ]);
  });

  test("no crop -> scale only", () => {
    const args = buildPreviewArgs({ in: "a.mp4", out: "b.jpg", time: 0, maxW: 480, crop: null });
    expect(args[args.indexOf("-vf") + 1]).toBe("scale=480:-2:flags=lanczos");
  });
});

describe("buildAvifArgs", () => {
  test("svt-av1 full-res animated AVIF at a given crf (no scale)", () => {
    expect(
      buildAvifArgs({ in: "inter.mp4", out: "clip1.avif", crf: 30, encoder: "libsvtav1" }),
    ).toEqual([
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-progress", "pipe:1",
      "-i", "inter.mp4",
      "-c:v", "libsvtav1", "-crf", "30", "-pix_fmt", "yuv420p",
      "-an", "clip1.avif",
    ]);
  });

  test("sharable rung: scale to the rung edge and fps filter", () => {
    expect(
      buildAvifArgs({ in: "inter.mp4", out: "clip1.avif", crf: 29, encoder: "libsvtav1", scaleTo: 640, fps: 25 }),
    ).toEqual([
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-progress", "pipe:1",
      "-i", "inter.mp4",
      "-vf", "scale=640:-2:flags=lanczos,fps=25",
      "-c:v", "libsvtav1", "-crf", "29", "-pix_fmt", "yuv420p",
      "-an", "clip1.avif",
    ]);
  });

  test("axis h scales the height (portrait crop): the longest edge is the target", () => {
    expect(
      buildAvifArgs({ in: "inter.mp4", out: "clip1.avif", crf: 29, encoder: "libsvtav1", scaleTo: 640, fps: 25, axis: "h" }),
    ).toEqual([
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-progress", "pipe:1",
      "-i", "inter.mp4",
      "-vf", "scale=-2:640:flags=lanczos,fps=25",
      "-c:v", "libsvtav1", "-crf", "29", "-pix_fmt", "yuv420p",
      "-an", "clip1.avif",
    ]);
  });

  test("libaom fallback uses the same shape", () => {
    const args = buildAvifArgs({ in: "a.mp4", out: "b.avif", crf: 42, encoder: "libaom-av1" });
    const iv = args.indexOf("-c:v");
    expect(args.slice(iv, iv + 5)).toEqual(["-c:v", "libaom-av1", "-crf", "42", "-pix_fmt"]);
    expect(args[args.length - 1]).toBe("b.avif");
  });
});

describe("buildComboCutArgs", () => {
  const s = {
    in: "vod.mp4",
    out: "seg.mp4",
    start: 12.5,
    dur: 7.25,
    fps: 30,
    crop: CROP,
    targetW: 1920,
    targetH: 1080,
    fade: 0.5,
    audio: "source" as const,
  };

  test("source audio: crop, scale+pad to target, fps, fades on both edges, aac audio", () => {
    expect(buildComboCutArgs(s)).toEqual([
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-progress", "pipe:1",
      "-ss", "12.5", "-i", "vod.mp4",
      "-vf",
      "crop=1280:720:0:0," +
        "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2," +
        "fps=30," +
        "fade=t=in:st=0:d=0.5,fade=t=out:st=6.75:d=0.5," +
        "setpts=PTS-STARTPTS",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "14", "-pix_fmt", "yuv420p",
      "-af", "afade=t=in:st=0:d=0.5,afade=t=out:st=6.75:d=0.5", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
      "-t", "7.25", "seg.mp4",
    ]);
  });

  test("silent audio: anullsrc input, aac track, no -af on the source", () => {
    const args = buildComboCutArgs({ ...s, audio: "silent" });
    expect(args).toContain("anullsrc=r=48000:cl=stereo");
    expect(args).toContain("-c:a");
    expect(args).not.toContain("-af");
    expect(args).not.toContain("-an");
  });

  test("no audio: -an, no anullsrc, no -af", () => {
    const args = buildComboCutArgs({ ...s, audio: "none" });
    expect(args).toContain("-an");
    expect(args).not.toContain("anullsrc");
    expect(args).not.toContain("-af");
  });

  test("no crop -> scale+pad only (still pads to the group target)", () => {
    const args = buildComboCutArgs({ ...s, crop: null, targetW: 640, targetH: 360, fade: 0.3 });
    const vf = args[args.indexOf("-vf") + 1];
    expect(vf.startsWith("crop")).toBe(false);
    expect(vf.startsWith("scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:")).toBe(true);
    expect(vf).toContain("fade=t=out:st=6.95:d=0.3");
  });
});

describe("buildConcatArgs", () => {
  test("concat demuxer + the mp4 recipe (nvenc, audio)", () => {
    expect(
      buildConcatArgs({
        list: "list.txt",
        out: "combined.mp4",
        audio: true,
        encoder: "h264_nvenc",
        kbit: 2500,
      }),
    ).toEqual([
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-progress", "pipe:1",
      "-f", "concat", "-safe", "0", "-i", "list.txt",
      "-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq", "-rc", "vbr",
      "-multipass", "fullres",
      "-b:v", "2500k", "-maxrate", "3750k", "-bufsize", "5000k",
      "-rc-lookahead", "32", "-spatial-aq", "1", "-profile:v", "high",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
      "-movflags", "+faststart", "combined.mp4",
    ]);
  });

  test("x264 fallback + no audio", () => {
    const args = buildConcatArgs({
      list: "list.txt",
      out: "combined.mp4",
      audio: false,
      encoder: "libx264",
      kbit: 1234,
    });
    expect(args).toContain("-c:v");
    expect(args[args.indexOf("-c:v") + 1]).toBe("libx264");
    expect(args).toContain("-b:v");
    expect(args[args.indexOf("-b:v") + 1]).toBe("1234k");
    expect(args).toContain("-an");
    expect(args).not.toContain("-c:a");
  });
});

describe("buildComboShareSectionArgs", () => {
  test("source audio: seek the middle, 30fps, fades on both edges, fast intermediate", () => {
    expect(
      buildComboShareSectionArgs({
        in: "seg.mp4",
        out: "sec.mp4",
        ss: 76.2,
        dur: 10.5,
        fps: 30,
        fade: 0.5,
        audio: "source",
      }),
    ).toEqual([
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-progress", "pipe:1",
      "-ss", "76.2", "-i", "seg.mp4",
      "-vf", "fps=30,fade=t=in:st=0:d=0.5,fade=t=out:st=10:d=0.5,setpts=PTS-STARTPTS",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "14", "-pix_fmt", "yuv420p",
      "-af", "afade=t=in:st=0:d=0.5,afade=t=out:st=10:d=0.5",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
      "-t", "10.5", "sec.mp4",
    ]);
  });

  test("silent part: a silent aac track keeps the concat uniform, no afade", () => {
    expect(
      buildComboShareSectionArgs({
        in: "seg.mp4",
        out: "sec.mp4",
        ss: 0,
        dur: 15,
        fps: 30,
        fade: 0.5,
        audio: "silent",
      }),
    ).toEqual([
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-progress", "pipe:1",
      "-ss", "0", "-i", "seg.mp4",
      "-f", "lavfi", "-t", "15", "-i", "anullsrc=r=48000:cl=stereo",
      "-vf", "fps=30,fade=t=in:st=0:d=0.5,fade=t=out:st=14.5:d=0.5,setpts=PTS-STARTPTS",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "14", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
      "-t", "15", "sec.mp4",
    ]);
  });

  test("a group without audio: -an", () => {
    expect(
      buildComboShareSectionArgs({
        in: "seg.mp4",
        out: "sec.mp4",
        ss: 5,
        dur: 8,
        fps: 30,
        fade: 0.5,
        audio: "none",
      }),
    ).toEqual([
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-progress", "pipe:1",
      "-ss", "5", "-i", "seg.mp4",
      "-vf", "fps=30,fade=t=in:st=0:d=0.5,fade=t=out:st=7.5:d=0.5,setpts=PTS-STARTPTS",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "14", "-pix_fmt", "yuv420p",
      "-an",
      "-t", "8", "sec.mp4",
    ]);
  });
});

describe("buildComboShareArgs", () => {
  test("x264, width axis, audio: sections concat-demuxed, scale to the rung, crf, 96k aac", () => {
    expect(
      buildComboShareArgs({
        list: "list.txt",
        out: "out.mp4",
        fps: 30,
        edge: 1080,
        axis: "w",
        encoder: "libx264",
        crf: 20,
        audio: true,
      }),
    ).toEqual([
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-progress", "pipe:1",
      "-f", "concat", "-safe", "0", "-i", "list.txt",
      "-vf", "scale=1080:-2:flags=lanczos,fps=30,setpts=PTS-STARTPTS",
      "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-profile:v", "high",
      "-c:a", "aac", "-b:a", "96k", "-ar", "48000",
      "-movflags", "+faststart", "out.mp4",
    ]);
  });

  test("nvenc, height axis, no audio: crf-mode nvenc, -an", () => {
    expect(
      buildComboShareArgs({
        list: "list.txt",
        out: "out.mp4",
        fps: 30,
        edge: 512,
        axis: "h",
        encoder: "h264_nvenc",
        crf: 20,
        audio: false,
      }),
    ).toEqual([
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-progress", "pipe:1",
      "-f", "concat", "-safe", "0", "-i", "list.txt",
      "-vf", "scale=-2:512:flags=lanczos,fps=30,setpts=PTS-STARTPTS",
      "-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq", "-rc", "constqp",
      "-cq", "20", "-profile:v", "high",
      "-an",
      "-movflags", "+faststart", "out.mp4",
    ]);
  });
});
