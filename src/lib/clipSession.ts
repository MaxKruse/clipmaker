import type { ClipSpec } from "./types";

/** Guided add-clip flow: idle, set the times (timeline glows), optional crop (player glows). */
export type FlowStep = "idle" | "set-times" | "crop";

/** The in/out range the timeline frames (with margin) for fine adjustment. */
export interface ClipFocus {
  start: number;
  end: number;
}

/**
 * The clip session: which clip is under preview, where "back" goes,
 * the timeline focus, whether the in/out range is live, and the
 * guided add-clip step. These states move together in groups; this
 * reducer is the single place that knows the groups.
 */
export interface ClipSession {
  /** Clip under preview (selected in the queue); null = free playback. */
  clipId: string | null;
  /** Position "back" restores; null = nothing pending. */
  returnTo: number | null;
  focus: ClipFocus | null;
  /** The in/out range is live (playback loops it, the timeline shows it). */
  hasRange: boolean;
  step: FlowStep;
}

export const initialClipSession: ClipSession = {
  clipId: null,
  returnTo: null,
  focus: null,
  hasRange: false,
  step: "idle",
};

export type ClipSessionEvent =
  | { type: "video-changed" }
  | { type: "select-clip"; clipId: string; start: number; end: number; playhead: number }
  | { type: "add-clip"; clipId: string }
  | { type: "leave-preview" }
  | { type: "deselect" }
  | { type: "cancel-return" }
  | { type: "set-range" }
  | { type: "clear-range" }
  | { type: "imported" }
  | { type: "patched"; patch: Partial<ClipSpec> };

export function clipSessionReducer(s: ClipSession, e: ClipSessionEvent): ClipSession {
  switch (e.type) {
    case "video-changed":
    case "leave-preview":
      // Leaving the preview consumes the return position (the page
      // restores it from s.returnTo before dispatching).
      return initialClipSession;
    case "select-clip":
      return {
        clipId: e.clipId,
        // Keep the original pre-preview position across consecutive
        // clip jumps; capture the playhead only when none is pending.
        returnTo: s.returnTo ?? e.playhead,
        focus: { start: e.start, end: e.end },
        hasRange: true,
        step: "idle",
      };
    case "add-clip":
      return {
        ...s,
        clipId: e.clipId,
        hasRange: true,
        // No live range yet: the times still need setting. One live:
        // the times came from it, so the flow offers the crop.
        step: s.hasRange ? "crop" : "set-times",
      };
    case "deselect":
      // Deleting the previewed clip when none remains: end the
      // preview, but keep the return position (it is still pending).
      return { ...s, clipId: null, focus: null, hasRange: false, step: "idle" };
    case "cancel-return":
      return s.returnTo === null ? s : { ...s, returnTo: null };
    case "set-range":
      // Setting in/out also accepts the preview position as the new one.
      return s.hasRange && s.returnTo === null ? s : { ...s, hasRange: true, returnTo: null };
    case "clear-range":
      return s.hasRange ? { ...s, hasRange: false } : s;
    case "imported":
      return s.step === "idle" ? s : { ...s, step: "idle" };
    case "patched": {
      let step = s.step;
      if (step === "set-times" && (e.patch.start !== undefined || e.patch.end !== undefined)) step = "crop";
      if (step === "crop" && e.patch.crop) step = "idle";
      return step === s.step ? s : { ...s, step };
    }
  }
}
