import { spawn, spawnSync } from "node:child_process";

// Fallback locations when the binary is not on PATH (this machine).
const BIN_FALLBACKS: Record<string, string> = {
  ffmpeg: "c:\\programdata\\chocolatey\\bin\\ffmpeg.exe",
  ffprobe: "c:\\programdata\\chocolatey\\bin\\ffprobe.exe",
};

const binCache = new Map<string, string>();

/** Resolve the ffmpeg/ffprobe binary: env override > PATH > known fallbacks. */
export function findBin(name: "ffmpeg" | "ffprobe"): string {
  const cached = binCache.get(name);
  if (cached) return cached;
  const envKey = name === "ffmpeg" ? "CLIPMAKER_FFMPEG" : "CLIPMAKER_FFPROBE";
  const seen = new Set<string>();
  const candidates = [process.env[envKey] ?? "", name, BIN_FALLBACKS[name]].filter(
    (c): c is string => {
      if (!c || seen.has(c)) return false;
      seen.add(c);
      return true;
    },
  );
  for (const c of candidates) {
    const r = spawnSync(c, ["-version"], { timeout: 15_000 });
    if (r.status === 0) {
      binCache.set(name, c);
      return c;
    }
  }
  throw new Error(`ffmpeg binary not found (tried: ${candidates.join(", ")})`);
}

function tail(s: string): string {
  const t = s.trim();
  return t.length > 1500 ? `…${t.slice(-1500)}` : t;
}

/** Run a command, resolve with captured output, reject with the error tail. */
export function run(
  bin: string,
  args: string[],
  timeoutMs = 0,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const { promise, resolve, reject } = Promise.withResolvers<{
    code: number;
    stdout: string;
    stderr: string;
  }>();
  const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stdout = "";
  let stderr = "";
  let timer: NodeJS.Timeout | undefined;
  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timeout after ${timeoutMs}ms: ${bin}`));
    }, timeoutMs);
  }
  child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
  child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
  child.on("error", (e) => {
    clearTimeout(timer);
    reject(e);
  });
  child.on("close", (code) => {
    clearTimeout(timer);
    if (code === 0) resolve({ code, stdout, stderr });
    else reject(new Error(`${bin} failed (${code}): ${tail(stderr) || tail(stdout)}`));
  });
  return promise;
}
/**
 * Run ffmpeg with `-progress pipe:1` and report 0..1 progress from out_time.
 * The args must already contain `-progress pipe:1`.
 */
export function runProgress(
  bin: string,
  args: string[],
  totalSec: number,
  onPct: (pct: number) => void,
): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let buf = "";
  let stderr = "";
  const handleLine = (line: string) => {
    const eq = line.indexOf("=");
    if (eq < 0) return;
    const key = line.slice(0, eq);
    const val = Number(line.slice(eq + 1));
    if (!Number.isFinite(val) || totalSec <= 0) return;
    const us = key === "out_time_us" ? 1_000_000 : key === "out_time_ms" ? 1_000 : 0;
    if (us) {
      const pct = Math.min(0.99, val / (totalSec * us));
      if (Number.isFinite(pct)) onPct(pct);
    }
  };
  child.stdout.on("data", (d: Buffer) => {
    buf += d.toString();
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      handleLine(buf.slice(0, nl).trim());
      buf = buf.slice(nl + 1);
    }
  });
  child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
  child.on("error", reject);
  child.on("close", (code) => {
    if (code === 0) {
      onPct(1);
      resolve();
    } else {
      reject(new Error(`ffmpeg failed (${code}): ${tail(stderr)}`));
    }
  });
  return promise;
}

/** Parse a rational fps string like "30000/1001" -> 29.97. */
export function parseFpsRate(rate: string): number {
  const m = rate.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) return 0;
  const d = Number(m[2]);
  if (!d) return 0;
  return Math.round((Number(m[1]) / d) * 1000) / 1000;
}

export interface ProbeResult {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  videoKbit: number | null;
  audioKbit: number | null;
  formatKbit: number | null;
  sizeBytes: number;
}

interface FfprobeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  duration?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  bit_rate?: string;
}
interface FfprobeJson {
  format?: { duration?: string; bit_rate?: string; size?: string };
  streams?: FfprobeStream[];
}

/** ffprobe a video file into the metadata the app needs. */
export async function probeVideo(file: string): Promise<ProbeResult> {
  const { stdout } = await run(
    findBin("ffprobe"),
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file],
    120_000,
  );
  let j: FfprobeJson;
  try {
    j = JSON.parse(stdout);
  } catch {
    throw new Error("could not parse ffprobe output");
  }
  const v = j.streams?.find((s) => s.codec_type === "video");
  const a = j.streams?.find((s) => s.codec_type === "audio");
  const kbit = (b?: string) => (b ? Math.round(Number(b) / 1000) : null);
  const fps = parseFpsRate(v?.r_frame_rate ?? "") || parseFpsRate(v?.avg_frame_rate ?? "") || 30;
  return {
    duration: Number(j.format?.duration ?? 0),
    width: v?.width ?? 0,
    height: v?.height ?? 0,
    fps,
    hasAudio: Boolean(a),
    videoKbit: kbit(v?.bit_rate),
    audioKbit: kbit(a?.bit_rate),
    formatKbit: kbit(j.format?.bit_rate),
    sizeBytes: Number(j.format?.size ?? 0),
  };
}

/** Container and video-stream durations (the skill's per-clip duration check). */
export async function streamDurations(file: string): Promise<{ container: number; video: number }> {
  const { stdout } = await run(
    findBin("ffprobe"),
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file],
    60_000,
  );
  const j = JSON.parse(stdout) as FfprobeJson;
  const v = j.streams?.find((s) => s.codec_type === "video");
  return {
    container: Number(j.format?.duration ?? 0),
    video: Number(v?.duration ?? j.format?.duration ?? 0),
  };
}

let nvencPromise: Promise<boolean> | null = null;

/**
 * Probe-encode 0.5s of testsrc at 320x180 with h264_nvenc. 320x180, not 64x64:
 * some drivers reject tiny frames even when nvenc works at real sizes.
 */
export function nvencAvailable(): Promise<boolean> {
  nvencPromise ??= (async () => {
    try {
      await run(
        findBin("ffmpeg"),
        [
          "-hide_banner", "-loglevel", "error",
          "-f", "lavfi", "-i", "testsrc=duration=0.5:size=320x180:rate=30",
          "-c:v", "h264_nvenc", "-f", "null", "-",
        ],
        90_000,
      );
      return true;
    } catch {
      return false;
    }
  })();
  return nvencPromise;
}
