import path from "node:path";
import type { Job } from "./types";
import { dateFromVideoId } from "./vodDate";

// Server-only: this module imports node builtins. It must never be imported
// from client components - the client-facing job helpers live in jobs.ts.

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
  return j.outputs.every(
    (o) => !exists(path.join(outDir, j.videoId, dateFromVideoId(j.videoId) ?? "", o.name)),
  );
}
