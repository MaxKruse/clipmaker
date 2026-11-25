import fs from "node:fs";
import path from "node:path";
import { timestampsForVideo } from "./clipsTxt";
import type { Job, ClipSpec } from "./types";
import { dateFromVideoId } from "./vodDate";

// Server-only: this module imports node builtins. It must never be imported
// from client components - the client-facing job helpers live in jobs.ts.

/**
 * The video's export dir: out/<videoId>/, plus a subfolder of just the
 * date for dated ids. The single place the date-subfolder rule lives -
 * the runner, the download route, and outputsGone all resolve through it.
 */
export function exportDir(outBase: string, videoId: string): string {
  return path.join(outBase, videoId, dateFromVideoId(videoId) ?? "");
}

/** An output file under the video's export dir (name may be sharable/ or highlights/...). */
export function outputPath(outBase: string, videoId: string, name: string): string {
  return path.join(exportDir(outBase, videoId), name);
}

/**
 * The clips-mirror file: out/<videoId>/timestamps.txt, ALWAYS at the video
 * root (never the date subfolder, so the file finds its video folder at a
 * glance). One line per clip; an empty list deletes the file. Best-effort
 * by contract: the caller swallows failures - a mirror problem never fails
 * a clip save or an export job.
 */
export function saveTimestampsMirror(
  videoId: string,
  clips: Pick<ClipSpec, "start" | "end" | "note">[],
  outBase: string,
): void {
  if (!videoId || videoId.includes("/") || videoId.includes("\\") || videoId.includes("..")) return;
  const dir = path.join(outBase, videoId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "timestamps.txt");
  if (clips.length === 0) fs.rmSync(file, { force: true });
  else fs.writeFileSync(file, timestampsForVideo(clips));
}

/**
 * Only a bare output name, or one under sharable/ or highlights/, may
 * reach the out dir: jobs.json rows carrying any other name are dropped
 * when the store loads, so a corrupt or hostile row can never steer the
 * download route outside its video's export dir.
 */
export function safeOutputName(name: string): boolean {
  if (!name || name.includes("..") || name.startsWith("/")) return false;
  const parts = name.split("/");
  return (
    parts.length <= 2 &&
    (parts.length === 1 || parts[0] === "sharable" || parts[0] === "highlights")
  );
}

/**
 * True when a settled "done" job has no outputs left in its export dir
 * (`<outDir>/<videoId>/`, plus the date subfolder for dated ids) - the
 * files were deleted out from under it, so the row would only offer
 * broken downloads and is dropped when the store loads. Non-done rows
 * are history, not download targets: always kept. `exists` is injected
 * to keep the rule testable without disk IO.
 */
export function outputsGone(
  j: Pick<Job, "status" | "videoId" | "outputs">,
  outDir: string,
  exists: (p: string) => boolean,
): boolean {
  if (j.status !== "done" || j.outputs.length === 0) return false;
  return j.outputs.every((o) => !exists(outputPath(outDir, j.videoId, o.name)));
}
