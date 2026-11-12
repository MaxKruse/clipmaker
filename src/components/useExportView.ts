"use client";

import { useEffect, useReducer } from "react";
import { exportViewReducer, initialExportView, type ExportView } from "@/lib/exportView";

/**
 * The export view as a state machine (rules in lib/exportView.ts).
 * The page renders the modal only while `view` is "modal" AND at least
 * one job exists; otherwise the pill (which renders nothing itself
 * when there are no jobs).
 */
export function useExportView(activeJobs: number): {
  view: ExportView;
  show: () => void;
  dismiss: () => void;
} {
  const [state, dispatch] = useReducer(exportViewReducer, initialExportView);
  useEffect(() => {
    dispatch({ type: "jobs-changed", activeJobs });
  }, [activeJobs]);
  return {
    view: state.view,
    show: () => dispatch({ type: "show" }),
    dismiss: () => dispatch({ type: "dismiss" }),
  };
}
