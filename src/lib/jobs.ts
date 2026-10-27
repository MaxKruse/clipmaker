import type { Job } from "./types";

/**
 * Display order for the export list: newest export batch first, and
 * within a batch the clip order (top to bottom = #1, #2, ...). One
 * export request stamps every job with the same createdAt, so tied
 * timestamps must keep creation order - Array.prototype.sort is
 * stable, so no secondary key.
 */
export function sortJobs(jobs: Job[]): Job[] {
  return [...jobs].sort((a, b) => b.createdAt - a.createdAt);
}
