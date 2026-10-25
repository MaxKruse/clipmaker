import { describe, expect, test } from "bun:test";
import {
  buildGifPaletteArgs,
  buildGifStage1Args,
  buildGifStage3Args,
  buildMp4Args,
  buildPreviewArgs,
} from "../src/lib/args";

const CROP = { x: 0, y: 0, w: 1280, h: 720 };

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
  test("cut temp 1024p30 mp4 from source with crop", () => {
    expect(
      buildGifStage1Args({
        in: "vod.mp4", out: "inter.mp4", start: 30, dur: 10,
        maxEdge: 1024, crop: CROP,
      }),
    ).toEqual([
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-progress", "pipe:1",
      "-ss", "30", "-i", "vod.mp4", "-t", "10",
      "-vf", "crop=1280:720:0:0,fps=30,scale=1024:-2:flags=lanczos",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "14", "-pix_fmt", "yuv420p",
      "-an", "inter.mp4",
    ]);
  });
});

describe("buildGifPaletteArgs", () => {
  test("palettegen from the temp mp4 only", () => {
    expect(buildGifPaletteArgs({ in: "inter.mp4", out: "pal.png" })).toEqual([
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
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
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-i", "inter.mp4", "-i", "pal.png",
      "-lavfi", "fps=25,scale=512:-2:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5",
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
