import type { Job, JobOutput } from "./types";

/**
 * Tier of an output. Rows written before the tier field existed carry the
 * sharable copy under sharable/, so the path infers it there.
 */
export function resolveTier(o: JobOutput): "full" | "sharable" | "preview" {
  return o.tier ?? (o.name.includes("sharable/") ? "sharable" : "full");
}

/**
 * The output a download link points at. One job carries several outputs of
 * the same kind (the full and the sharable tier of gif/avif), so the tier is
 * part of the lookup; a link without a tier keeps the first match, which is
 * what the links written before the tiers pointed at.
 */
export function findOutput(outputs: JobOutput[], kind: string, tier?: string): JobOutput | undefined {
  for (const o of outputs) {
    if (o.kind !== kind) continue;
    if (!tier || resolveTier(o) === tier) return o;
  }
  return undefined;
}
/**
 * Display order for the export list: newest export batch first, and
 * within a batch the clip order (top to bottom = #1, #2, ...). One
 * export request stamps every job with the same createdAt, so the clip
 * number breaks the tie - the sort is stable, but the input order is
 * not guaranteed to be clip order.
 */
export function sortJobs(jobs: Job[]): Job[] {
  return [...jobs].sort((a, b) => b.createdAt - a.createdAt || a.clipNo - b.clipNo);
}

/**
 * Export batches in display order: one export request stamps every job it
 * enqueues with the same createdAt, so in a sortJobs-ordered list the
 * consecutive runs sharing a createdAt are the batches. Re-exporting the
 * same clips produces a second batch, which is what lets the export view
 * tell two "#1 Nuzzle" rows apart.
 */
export function groupBatches(jobs: Job[]): Job[][] {
  const groups: Job[][] = [];
  for (const j of jobs) {
    const last = groups[groups.length - 1];
    if (last && last[0].createdAt === j.createdAt) last.push(j);
    else groups.push([j]);
  }
  return groups;
}

/** Batch header: the local wall-clock time the batch was exported. */
export function batchTimeLabel(createdAt: number): string {
  const d = new Date(createdAt);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** A job still occupying the export pool: queued or running. */
export function isActiveJob(j: Job): boolean {
  return j.status === "queued" || j.status === "running";
}

/** Status split for the modal header, the pill label, and the clear button. */
export function jobCounts(jobs: Job[]): { active: number; done: number; failed: number } {
  let active = 0;
  let done = 0;
  let failed = 0;
  for (const j of jobs) {
    if (isActiveJob(j)) active++;
    else if (j.status === "error") failed++;
    else done++;
  }
  return { active, done, failed };
}
