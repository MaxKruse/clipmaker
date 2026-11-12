import { describe, expect, test } from "bun:test";
import { exportViewReducer, initialExportView } from "../src/lib/exportView";

// The export view is a two-state machine (modal | pill); "hidden" is
// not a state - with no jobs the page renders nothing. The reducer is
// the single place that knows the transition rules.

describe("exportViewReducer", () => {
  test("starts as the pill, inactive", () => {
    expect(initialExportView).toEqual({ view: "pill", wasActive: false });
  });

  test("a batch going from none to active forces the modal open", () => {
    const s = exportViewReducer(initialExportView, { type: "jobs-changed", activeJobs: 2 });
    expect(s.view).toBe("modal");
    expect(s.wasActive).toBe(true);
  });

  test("the modal opens even on a page load that finds running jobs", () => {
    // Mount dispatches the first jobs-changed with the current count.
    const s = exportViewReducer(initialExportView, { type: "jobs-changed", activeJobs: 1 });
    expect(s.view).toBe("modal");
  });

  test("a user minimize is not overridden while the batch stays active", () => {
    let s = exportViewReducer(initialExportView, { type: "jobs-changed", activeJobs: 2 });
    s = exportViewReducer(s, { type: "dismiss" });
    expect(s.view).toBe("pill");
    s = exportViewReducer(s, { type: "jobs-changed", activeJobs: 1 });
    expect(s.view).toBe("pill");
  });

  test("show reopens the modal from the pill", () => {
    const s = exportViewReducer(
      exportViewReducer(initialExportView, { type: "jobs-changed", activeJobs: 1 }),
      { type: "dismiss" },
    );
    expect(exportViewReducer(s, { type: "show" }).view).toBe("modal");
  });

  test("dismiss settles on the pill and resets the activity edge", () => {
    let s = exportViewReducer(initialExportView, { type: "jobs-changed", activeJobs: 1 });
    s = exportViewReducer(s, { type: "dismiss" });
    s = exportViewReducer(s, { type: "jobs-changed", activeJobs: 0 });
    expect(s.view).toBe("pill");
    expect(s.wasActive).toBe(false);
    // A later batch starts fresh: modal again.
    s = exportViewReducer(s, { type: "jobs-changed", activeJobs: 3 });
    expect(s.view).toBe("modal");
  });
});
