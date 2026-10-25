/** Parse "90", "1:30", "1:30.5" or "01:02:03.25" into seconds. Throws on garbage. */
export function parseTime(input: string): number {
  const t = input.trim();
  if (!t || t.startsWith("-")) throw new Error(`bad time: ${input}`);
  const parts = t.split(":");
  if (parts.length > 3) throw new Error(`bad time: ${input}`);
  let sec = 0;
  for (const p of parts) {
    if (!/^\d{1,3}(\.\d{1,3})?$/.test(p)) throw new Error(`bad time: ${input}`);
    sec = sec * 60 + parseFloat(p);
  }
  return sec;
}

/** Millisecond-precise display: "m:ss.mmm" or "h:mm:ss.mmm". */
export function formatTime(sec: number): string {
  const ms = Math.round(Math.max(0, sec) * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const ss = `${String(s).padStart(2, "0")}.${String(r).padStart(3, "0")}`;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Short display without millis: "m:ss" or "h:mm:ss" (rounded). */
export function formatShort(sec: number): string {
  const s = Math.round(Math.max(0, sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
}
