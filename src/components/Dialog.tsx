"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { isTopDialog, popDialog, pushDialog } from "@/lib/dialogStack";

interface Props {
  /** aria-label of the dialog. */
  label: string;
  /** Close (close button, Escape, backdrop click). */
  onClose: () => void;
  /** Overlay alignment/padding (e.g. "items-center justify-center p-4"). */
  overlay: string;
  /** Panel size/shape classes (Dialog adds `panel` and the shadow). */
  panel: string;
  /** Element that receives focus while the dialog is open. */
  focusRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}

/**
 * Shared dialog chrome for the app's modals: the backdrop, a
 * capture-phase Escape (only the TOPMOST open dialog acts on it, so
 * two stacked modals close one at a time), and focus on open /
 * restore on close. Capture phase + stopPropagation keeps the key
 * from reaching the Stage's window listener (bubble phase).
 */
export function Dialog({ label, onClose, overlay, panel, focusRef, children }: Props) {
  // The stable keydown listener reads the latest close callback.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const id = pushDialog();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !isTopDialog(id)) return;
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      popDialog(id);
    };
  }, []);

  // Focus lands on the focus element while the dialog is open (the
  // page underneath is inert for the keyboard), and returns to where
  // it was when the dialog goes away.
  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focusRef.current?.focus();
    return () => {
      if (prev && prev.isConnected) prev.focus();
    };
  }, []);

  return (
    <div
      className={`fixed inset-0 z-50 flex bg-black/70 ${overlay}`}
      onClick={(e) => {
        // Backdrop clicks only (a click inside the panel bubbles up
        // with the panel's element as target).
        if (e.target !== e.currentTarget) return;
        // Don't let the page's inert-background click leave the clip
        // preview too - the user only asked for the dialog to go away.
        e.stopPropagation();
        onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={label} className={`panel shadow-2xl ${panel}`}>
        {children}
      </div>
    </div>
  );
}
