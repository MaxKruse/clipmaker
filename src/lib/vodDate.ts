import { newId } from "./types";

/**
 * Dated output folders: when the source filename carries a broadcast
 * date, the video id (and thus its out/ folder) starts with that date,
 * and the export files sit in a subfolder of just the date:
 * out/2026-11-19_ab12cd34/2026-11-19/clip1.mp4. Names without a
 * recognizable date keep the plain random id and the flat layout.
 *
 * Two formats are recognized, in this order:
 * - YYYY-MM-DD  (Twitch/Kick downloads: "twitch_user_2026-11-19 08-27-22_...")
 * - YYYYMMDD    (as a full 8-digit run: "20261007_...")
 * The first plausible date in the name wins; month/day are range-checked.
 */

const DASHED = /(?:19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])/;
// Lookarounds keep the 8-digit form from matching inside a longer digit run.
const DIGITS = /(?<!\d)((?:19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01]))(?!\d)/;

/** The broadcast date (YYYY-MM-DD) in a file name, or null. */
export function vodDate(name: string): string | null {
  const d = name.match(DASHED);
  if (d) return d[0];
  const n = name.match(DIGITS);
  if (n) return `${n[1].slice(0, 4)}-${n[1].slice(4, 6)}-${n[1].slice(6)}`;
  return null;
}

/** Video id for a new source: `<date>_<random>` when the name has a
 * date, plain `<random>` otherwise. */
export function newVideoId(name: string): string {
  const date = vodDate(name);
  return date ? `${date}_${newId()}` : newId();
}

// The dated-id contract newVideoId produces. Legacy random ids never match.
const DATED_ID = /^(\d{4}-\d{2}-\d{2})_[0-9a-z]{1,8}$/;

/** The date prefix of a dated video id, null when the id has none. */
export function dateFromVideoId(id: string): string | null {
  const m = id.match(DATED_ID);
  return m ? m[1] : null;
}
