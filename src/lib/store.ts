import fs from "node:fs";
import path from "node:path";
import { sortJobs } from "./jobs";
import type { ClipSpec, Job, VideoInfo } from "./types";

// Disk-backed so state survives HMR reloads and dev-server restarts.
const DATA_DIR = path.join(process.cwd(), ".data");
const VIDEOS_FILE = path.join(DATA_DIR, "videos.json");
const JOBS_FILE = path.join(DATA_DIR, "jobs.json");
const CLIPS_FILE = path.join(DATA_DIR, "clips.json");

export const UPLOADS_DIR = path.join(process.cwd(), "uploads");
export const OUT_DIR = path.join(process.cwd(), "out");
export const TMP_DIR = path.join(process.cwd(), ".tmp");

/** Only a bare output name, or one under sharable/, may reach the out dir. */
function safeOutputName(name: string): boolean {
  if (!name || name.includes("..") || name.startsWith("/")) return false;
  const parts = name.split("/");
  return parts.length <= 2 && (parts.length === 1 || parts[0] === "sharable");
}

class Store {
  videos = new Map<string, VideoInfo>();
  jobs = new Map<string, Job>();
  clips = new Map<string, ClipSpec[]>();

  constructor() {
    this.loadVideos();
    this.loadJobs();
    this.loadClips();
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
    for (const v of Object.values(raw)) {
      // Drop sessions whose source file is gone (moved/deleted outside the app).
      if (v && v.id && v.path && fs.existsSync(v.path)) this.videos.set(v.id, v);
    }
  }

  private loadJobs() {
    let raw: Job[];
    try {
      raw = JSON.parse(fs.readFileSync(JOBS_FILE, "utf8"));
    } catch {
      return;
    }
    for (const j of raw) {
      if (!j || !j.id) continue;
      // A job whose video is gone has nothing to download, and an output
      // name that escapes the out dir must never reach the download route.
      if (!this.videos.has(j.videoId)) continue;
      if (j.outputs?.some((o) => !safeOutputName(o.name))) continue;
      if (j.status === "running" || j.status === "queued") {
        j.status = "error";
        j.stage = null;
        j.error = "server restarted before the job finished";
      }
      // Legacy jobs.json rows carry the stage as a free string; the
      // structured JobStage replaced it. The error text keeps the context.
      if (typeof j.stage === "string") j.stage = null;
      this.jobs.set(j.id, j);
    }
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
    this.jobs.set(j.id, j);
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
    for (const [id, list] of Object.entries(raw)) {
      if (Array.isArray(list)) this.clips.set(id, list.filter((c) => c && typeof c.id === "string"));
    }
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
}

export const store = new Store();
