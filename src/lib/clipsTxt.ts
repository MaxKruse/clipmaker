import { parseTime } from "./times";

/** One parsed clip line: a time range plus the note text that follows it. */
export interface TxtClip {
  start: number;
  end: number;
  note: string;
}

/** A block of clips under one `# header` line (a VOD filename/title). */
export interface TxtSection {
  title: string;
  clips: TxtClip[];
}

// `14:47 - 15:22 Cute` / `1:01:41 - 1:02:54 Guh`; dash may be - / – / —
const LINE_RE = /^(\S+)\s*[-\u2013\u2014]\s*(\S+)\s*(.*)$/;

/**
 * Parse a clips note file. Clip lines are `<start> - <end> <note?>`
 * (m:ss, h:mm:ss, plain seconds); `# header` lines start a new section
 * (typically a VOD filename); blank lines are ignored. Unparseable
 * non-blank lines are counted in `skipped`.
 */
export function parseClipsTxt(
  text: string,
): { sections: TxtSection[]; skipped: number } {
  const sections: TxtSection[] = [{ title: "", clips: [] }];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      sections.push({ title: line.slice(1).trim(), clips: [] });
      continue;
    }
    const m = LINE_RE.exec(line);
    if (!m) {
      skipped++;
      continue;
    }
    let start: number;
    let end: number;
    try {
      start = parseTime(m[1]);
      end = parseTime(m[2]);
    } catch {
      skipped++;
      continue;
    }
    if (end <= start) {
      skipped++;
      continue;
    }
    sections[sections.length - 1].clips.push({
      start,
      end,
      note: m[3].trim(),
    });
  }
  return { sections, skipped };
}

/**
 * Pick the section belonging to a video: its header must contain the
 * video's file name, with or without the extension. Returns null when
 * none, or more than one, section matches.
 */
export function sectionForVideo(
  sections: TxtSection[],
  videoName: string,
): TxtSection | null {
  const base = videoName.replace(/\.[a-z0-9]+$/i, "").toLowerCase();
  const name = videoName.toLowerCase();
  const hits = sections.filter(
    (s) =>
      s.clips.length > 0 &&
      s.title &&
      (s.title.toLowerCase().includes(base) ||
        s.title.toLowerCase().includes(name)),
  );
  return hits.length === 1 ? hits[0] : null;
}
