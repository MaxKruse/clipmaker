/**
 * The pipeline stage of a running export job. Structured (not a free
 * string) so the runner builds it exhaustively; `stageText` renders the
 * user-facing wording for the export modal. Persisted in jobs.json as
 * the object; legacy string stages predate this and migrate to null.
 */
export type JobStage =
  | { id: "starting" }
  | { id: "combo-cut"; index: number; total: number }
  | { id: "mp4-encode"; encoder: string; kbit: number; fps: number }
  | { id: "mp4-retry" }
  | { id: "mp4-share-cut"; index: number; total: number }
  | { id: "mp4-share-rung"; edge: number; fps: number; index: number; total: number }
  | { id: "anim-cut" }
  | { id: "gif-palette" }
  | { id: "gif-full"; edge: number; fps: number }
  | { id: "gif-rung"; edge: number; fps: number; index: number; total: number }
  | { id: "gif-emergency"; edge: number; fps: number }
  | { id: "gif-verify" }
  | { id: "avif-full"; encoder: string; crf: number }
  | { id: "avif-rung"; crf: number; edge: number; fps: number; index: number; total: number }
  | { id: "avif-emergency"; crf: number; edge: number; fps: number }
  | { id: "avif-verify" };

export function stageText(s: JobStage): string {
  switch (s.id) {
    case "starting":
      return "starting";
    case "combo-cut":
      return `combine: part ${s.index}/${s.total}`;
    case "mp4-encode":
      return `mp4 ${s.encoder} ${s.kbit}k ${s.fps}fps`;
    case "mp4-retry":
      return "mp4 retry";
    case "mp4-share-cut":
      return `mp4 sharable section ${s.index}/${s.total}`;
    case "mp4-share-rung":
      return `mp4 sharable ${s.edge}p${s.fps} (${s.index}/${s.total})`;
    case "anim-cut":
      return "anim: cut (full-res)";
    case "gif-palette":
      return "gif: palette";
    case "gif-full":
      return `gif: full ${s.edge}p${s.fps}`;
    case "gif-rung":
      return `gif: sharable ${s.edge}p${s.fps} (${s.index}/${s.total})`;
    case "gif-emergency":
      return `gif: sharable ${s.edge}p${s.fps} (emergency)`;
    case "gif-verify":
      return "gif: verify";
    case "avif-full":
      return `avif: full ${s.encoder} crf${s.crf}`;
    case "avif-rung":
      return `avif: sharable crf${s.crf} ${s.edge}p${s.fps} (${s.index}/${s.total})`;
    case "avif-emergency":
      return `avif: sharable crf${s.crf} ${s.edge}p${s.fps} (emergency)`;
    case "avif-verify":
      return "avif: verify";
  }
}
