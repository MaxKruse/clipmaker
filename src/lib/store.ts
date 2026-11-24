import fs from "node:fs";
import path from "node:path";
import { toDefaults } from "./clips";
import { sortJobs } from "./jobs";
import { outputsGone, safeOutputName } from "./jobFiles";
import { defaultClipDefaults, type ClipDefaults, type ClipSpec, type Job, type VideoInfo } from "./types";

// Disk-backed so state survives HMR reloads and dev-server restarts.
const DATA_DIR = path.join(process.cwd(), ".data");
const VIDEOS_FILE = path.join(DATA_DIR, "videos.json");
const JOBS_FILE = path.join(DATA_DIR, "jobs.json");
const CLIPS_FILE = path.join(DATA_DIR, "clips.json");
const DEFAULTS_FILE = path.join(DATA_DIR, "defaults.json");

export const UPLOADS_DIR = path.join(process.cwd(), "uploads");
export const OUT_DIR = path.join(process.cwd(), "out");
export const TMP_DIR = path.join(process.cwd(), ".tmp");

/**
 * Drop folder for huge files: the next page load probes and moves whatever
 * is in here (lib/ingest.ts). Point CLIPMAKER_INGEST_DIR elsewhere (e.g. a
 * mount) to change the location.
 */
export const INGEST_DIR = process.env.CLIPMAKER_INGEST_DIR
  ? path.resolve(process.env.CLIPMAKER_INGEST_DIR)
  : path.join(process.cwd(), "ingest");

class Store {
  videos = new Map<string, VideoInfo>();
  jobs = new Map<string, Job>();
  clips = new Map<string, ClipSpec[]>();

  defaults: ClipDefaults = defaultClipDefaults();

  constructor() {
    this.loadVideos();
    this.loadJobs();
    this.loadClips();
    this.loadDefaults();
    this.sweepTmp();
  }

  /**
   * A restart kills every encode in flight, so nothing under .tmp belongs
   * to a live job. Sweeping it stops orphaned temp files from piling up.
   */
  private sweepTmp() {
    let names: string[];
    try {
      names = fs.readdirSync(TMP_DIR);
    } catch {
      return; // no temp dir yet
    }
    for (const name of names) {
      fs.rmSync(path.join(TMP_DIR, name), { recursive: true, force: true });
    }
  }

  private loadVideos() {
    let raw: Record<string, VideoInfo>;
    try {
      raw = JSON.parse(fs.readFileSync(VIDEOS_FILE, "utf8"));
    } catch {
      return;
    }
    let dropped = 0;
    for (const v of Object.values(raw)) {
      // Drop sessions whose source file is gone (moved/deleted outside the app).
      if (v && v.id && v.path && fs.existsSync(v.path)) this.videos.set(v.id, v);
      else dropped++;
    }
    // Rewrite the file so the disk matches the loaded sessions; without
    // this, dropped rows stay in videos.json until an unrelated save.
    if (dropped > 0) this.saveVideos();
  }

  private loadJobs() {
    let raw: Job[];
    try {
      raw = JSON.parse(fs.readFileSync(JOBS_FILE, "utf8"));
    } catch {
      return;
    }
    let kept = 0;
    let mutated = false;
    for (const j of raw) {
      kept++;
      if (!j || !j.id) continue;
      // A job whose video is gone has nothing to download, and an output
      // name that escapes the out dir must never reach the download route.
      if (!this.videos.has(j.videoId)) continue;
      if (j.outputs?.some((o) => !safeOutputName(o.name))) continue;
      if (j.status === "running" || j.status === "queued") {
        j.status = "error";
        j.stage = null;
        j.error = "server restarted before the job finished";
        mutated = true;
      }
      // Legacy jobs.json rows carry the stage as a free string; the
      // structured JobStage replaced it. The error text keeps the context.
      if (typeof j.stage === "string") j.stage = null;
      // A done job whose files were deleted (out/ cleaned by hand) would
      // only offer broken downloads - drop the row.
      if (outputsGone(j, OUT_DIR, fs.existsSync)) continue;
      this.jobs.set(j.id, j);
    }
    // Rewrite so dropped rows and status migrations don't linger on disk.
    if (kept < raw.length || mutated) this.saveJobs();
  }

  addVideo(v: VideoInfo) {
    this.videos.set(v.id, v);
    this.saveVideos();
  }

  /** Remove a session; uploaded sources are deleted from disk, user paths are not. */
  removeVideo(id: string) {
    const v = this.videos.get(id);
    this.videos.delete(id);
    this.clips.delete(id);
    if (v?.uploaded) fs.rmSync(path.dirname(v.path), { recursive: true, force: true });
    this.saveVideos();
    this.saveClips();
  }

  addJob(j: Job) {
    this.jobs.set(j.id, j);
    this.saveJobs();
  }

  updateJob(j: Job) {
    // A video deleted mid-export settles its jobs after removeVideo has
    // dropped them - a late update must not resurrect a row whose video
    // is gone (the download route would 404 on it anyway).
    if (!this.videos.has(j.videoId)) return;
    this.jobs.set(j.id, j);
    this.saveJobs();
  }

  /** Drop every job of a video; called right after removeVideo. */
  removeJobsForVideo(videoId: string) {
    for (const [id, j] of this.jobs) {
      if (j.videoId === videoId) this.jobs.delete(id);
    }
    this.saveJobs();
  }

  clearFinishedJobs() {
    for (const [id, j] of this.jobs) {
      if (j.status === "done" || j.status === "error") this.jobs.delete(id);
    }
    this.saveJobs();
  }

  listJobs(): Job[] {
    return sortJobs([...this.jobs.values()]);
  }

  private saveVideos() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const o: Record<string, VideoInfo> = {};
    for (const v of this.videos.values()) o[v.id] = v;
    fs.writeFileSync(VIDEOS_FILE, JSON.stringify(o, null, 2));
  }

  private saveJobs() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(JOBS_FILE, JSON.stringify([...this.jobs.values()], null, 2));
  }
  private loadClips() {
    let raw: Record<string, ClipSpec[]>;
    try {
      raw = JSON.parse(fs.readFileSync(CLIPS_FILE, "utf8"));
    } catch {
      return;
    }
    let dropped = 0;
    for (const [id, list] of Object.entries(raw)) {
      if (Array.isArray(list) && this.videos.has(id)) {
        const kept = list.filter((c) => c && typeof c.id === "string");
        // Invalid rows are dropped from the in-memory list; the disk
        // file must not keep them either, so the rewrite below covers it.
        dropped += list.length - kept.length;
        this.clips.set(id, kept);
      } else {
        // Orphan: the video no longer exists (removed via the UI, or its
        // source file was deleted outside the app).
        dropped++;
      }
    }
    if (dropped > 0) this.saveClips();
  }

  private saveClips() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CLIPS_FILE, JSON.stringify(Object.fromEntries(this.clips), null, 2));
  }

  getClips(videoId: string): ClipSpec[] {
    return this.clips.get(videoId) ?? [];
  }

  setClips(videoId: string, list: ClipSpec[]) {
    this.clips.set(videoId, list);
    this.saveClips();
  }

  /** New-clip defaults: a missing or corrupt file self-heals to the
   * shipped defaults (toDefaults falls back field by field). */
  private loadDefaults() {
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(DEFAULTS_FILE, "utf8"));
    } catch {
      return;
    }
    this.defaults = toDefaults(raw);
  }

  setDefaults(d: ClipDefaults) {
    this.defaults = d;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DEFAULTS_FILE, JSON.stringify(d, null, 2));
  }
}

export const store = new Store();
