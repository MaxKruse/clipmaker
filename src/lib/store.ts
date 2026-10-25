import fs from "node:fs";
import path from "node:path";
import type { Job, VideoInfo } from "./types";

// Disk-backed so state survives HMR reloads and dev-server restarts.
const DATA_DIR = path.join(process.cwd(), ".data");
const VIDEOS_FILE = path.join(DATA_DIR, "videos.json");
const JOBS_FILE = path.join(DATA_DIR, "jobs.json");

export const UPLOADS_DIR = path.join(process.cwd(), "uploads");
export const OUT_DIR = path.join(process.cwd(), "out");
export const TMP_DIR = path.join(process.cwd(), ".tmp");

class Store {
  videos = new Map<string, VideoInfo>();
  jobs = new Map<string, Job>();

  constructor() {
    this.loadVideos();
    this.loadJobs();
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
      if (j.status === "running" || j.status === "queued") {
        j.status = "error";
        j.stage = null;
        j.error = "server restarted before the job finished";
      }
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
    if (v?.uploaded) fs.rmSync(path.dirname(v.path), { recursive: true, force: true });
    this.saveVideos();
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
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
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
}

export const store = new Store();
