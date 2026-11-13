import type { Job, JobOutput } from "./types";

/**
 * Tier of an output. Rows written before the tier field existed carry the
 * sharable copy under sharable/, so the path infers it there.
 */
export function resolveTier(o: JobOutput): "full" | "sharable" {
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
