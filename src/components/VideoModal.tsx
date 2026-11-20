"use client";

import { useRef } from "react";
import type { TxtClip } from "@/lib/clipsTxt";
import type { VideoInfo } from "@/lib/types";
import { Dialog } from "./Dialog";
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
 * real estate.
 */
export function VideoModal({ onClose, ...loader }: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  return (
    <Dialog
      label="Videos"
      onClose={onClose}
      overlay="items-start justify-center p-4 pt-14"
      panel="w-full max-w-2xl p-3"
      focusRef={closeRef}
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
    </Dialog>
  );
}
