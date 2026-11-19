import { normalizeCrop } from "./crop";
import { ANIM_FPS_OPTIONS, ANIM_MAX_EDGE_OPTIONS, ANIM_MAX_MB_OPTIONS, FORMAT_OPTIONS, MIN_CLIP_SECONDS, MP4_FPS_OPTIONS, defaultClipDefaults, newId, type ClipDefaults, type ClipSpec, type Format } from "./types";

/** Sanitize an untrusted clip (JSON from the client) into a ClipSpec.
 * Throws with a human-readable message when the clip is unusable. */
export function toClip(raw: unknown, v: { duration: number; width: number; height: number }): ClipSpec {
  const r = raw as Record<string, any>;
  const start = Number(r?.start);
  let end = Number(r?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error("clip needs numeric start and end");
  if (start < 0) throw new Error("clip start must be >= 0");
  // Allow a small overshoot: the element duration can differ from the probe's.
  end = Math.min(end, v.duration + 0.5);
  if (end - start < MIN_CLIP_SECONDS)
    throw new Error(`clip must be at least ${MIN_CLIP_SECONDS}s long`);
  const formats = (Array.isArray(r.formats) ? r.formats : []).filter((f: unknown) => FORMAT_OPTIONS.includes(f as Format));
  if (formats.length === 0) throw new Error("pick at least one format");
  const fps = MP4_FPS_OPTIONS.includes(Number(r.fps)) ? Number(r.fps) : 60;
  const quality = {
    mode: r?.quality?.mode === "manual" ? ("manual" as const) : ("source" as const),
    kbit: Math.max(250, Math.round(Number(r?.quality?.kbit) || 0)),
  };
  // r.gif is the pre-avif key for the same options (old project files).
  const animRaw = r?.anim ?? r?.gif;
  const anim = {
    fps: ANIM_FPS_OPTIONS.includes(Number(animRaw?.fps)) ? Number(animRaw.fps) : 30,
    maxMB: ANIM_MAX_MB_OPTIONS.includes(Number(animRaw?.maxMB)) ? Number(animRaw.maxMB) : 48,
    maxEdge: ANIM_MAX_EDGE_OPTIONS.includes(Number(animRaw?.maxEdge)) ? Number(animRaw.maxEdge) : 1000,
  };
  const crop = r?.crop && typeof r.crop === "object" ? normalizeCrop(v.width, v.height, r.crop) : null;
  return {
    id: typeof r?.id === "string" ? r.id : newId(),
    note: typeof r?.note === "string" ? r.note : "",
    start,
    end,
    crop,
    formats,
    audio: Boolean(r?.audio),
    fps,
    quality,
    anim,
  };
}

/** Sanitize untrusted new-clip defaults (JSON from the client) into
 * ClipDefaults: invalid fields fall back to the shipped defaults, so a
 * hand-edited defaults.json self-heals on save. */
export function toDefaults(raw: unknown): ClipDefaults {
  const r = (raw ?? {}) as Record<string, any>;
  const d = defaultClipDefaults();
  const formats = (Array.isArray(r.formats) ? r.formats : []).filter((f: unknown) =>
    FORMAT_OPTIONS.includes(f as Format),
  );
  const mode: "source" | "manual" = r?.quality?.mode === "manual" ? "manual" : "source";
  const kbit = Math.round(Number(r?.quality?.kbit) || 0);
  return {
    formats: formats.length > 0 ? formats : [...d.formats],
    audio: typeof r.audio === "boolean" ? r.audio : d.audio,
    fps: MP4_FPS_OPTIONS.includes(Number(r.fps)) ? Number(r.fps) : d.fps,
    // Source mode ignores kbit (it stays 0); manual mode needs the 250 floor.
    quality: { mode, kbit: mode === "manual" ? Math.max(250, kbit) : kbit },
    anim: {
      fps: ANIM_FPS_OPTIONS.includes(Number(r?.anim?.fps)) ? Number(r.anim.fps) : d.anim.fps,
      maxMB: ANIM_MAX_MB_OPTIONS.includes(Number(r?.anim?.maxMB)) ? Number(r.anim.maxMB) : d.anim.maxMB,
      maxEdge: ANIM_MAX_EDGE_OPTIONS.includes(Number(r?.anim?.maxEdge)) ? Number(r.anim.maxEdge) : d.anim.maxEdge,
    },
  };
}
