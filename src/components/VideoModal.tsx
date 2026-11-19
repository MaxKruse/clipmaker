"use client";

import { useEffect, useRef } from "react";
import type { TxtClip } from "@/lib/clipsTxt";
import type { VideoInfo } from "@/lib/types";
import { VideoLoader } from "./VideoLoader";

interface Props {
  /** Called to close the modal (close button, Escape, backdrop). */
  onClose: () => void;
  videos: VideoInfo[];
  activeId: string | null;
  /** Select a loaded video (also closes the modal - the user is done managing). */
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onAdded: (v: VideoInfo) => void;
  /** Name of the active video, for matching section headers on import. */
  activeName: string | null;
  /** Called with parsed clip ranges to add to the active video. */
  onLoadClips: (clips: TxtClip[]) => void;
}

/**
 * Modal that hosts the video manager (the VideoLoader): the loaded-videos
 * list plus add-by-path, upload, and clips.txt import. The top bar only
 * shows a single button that opens this, so the work area keeps its
 * real estate. Follows the ExportModal dialog conventions: Esc (capture
 * phase, so it wins over the clip preview's Esc) and a backdrop click
 * both close it, and focus lands on the close button while open.
 */
export function VideoModal({ onClose, ...loader }: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Focus the close button on open; restore the previous holder on close.
  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      if (prev && prev.isConnected) prev.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 pt-14"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Videos"
        className="panel w-full max-w-2xl p-3 shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">Videos</h2>
          <button ref={closeRef} className="btn btn-sm" onClick={onClose}>
            close
          </button>
        </div>
        <VideoLoader
          videos={loader.videos}
          activeId={loader.activeId}
          onSelect={loader.onSelect}
          onRemove={loader.onRemove}
          onAdded={loader.onAdded}
          activeName={loader.activeName}
          onLoadClips={loader.onLoadClips}
        />
      </div>
    </div>
  );
}
