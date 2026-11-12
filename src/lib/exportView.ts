/**
 * The export view: a front-and-center modal while a batch runs,
 * minimizable to a corner pill. "Hidden" is not a state - with no
 * jobs the page renders nothing, so the machine is just modal | pill.
 *
 * Rules (the only place they live):
 * - A batch going from none to active (a fresh export, or a page load
 *   that finds running jobs) forces the modal open.
 * - The user can dismiss it to the pill at any time; while the batch
 *   stays active, later job updates do not reopen it.
 * - "show" (the pill, or a new export) reopens it.
 */
export type ExportView = "modal" | "pill";

export interface ExportViewState {
  view: ExportView;
  /** Edge detector: whether the previous poll had an active job. */
  wasActive: boolean;
}

export type ExportViewEvent =
  | { type: "jobs-changed"; activeJobs: number }
  | { type: "show" }
  | { type: "dismiss" };

export const initialExportView: ExportViewState = { view: "pill", wasActive: false };

export function exportViewReducer(state: ExportViewState, e: ExportViewEvent): ExportViewState {
  switch (e.type) {
    case "jobs-changed": {
      const active = e.activeJobs > 0;
      if (active === state.wasActive) return state;
      // Only the rising edge forces the modal; falling keeps the view.
      return { view: active ? "modal" : state.view, wasActive: active };
    }
    case "show":
      return state.view === "modal" ? state : { ...state, view: "modal" };
    case "dismiss":
      return state.view === "pill" ? state : { ...state, view: "pill" };
  }
}
