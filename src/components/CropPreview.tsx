"use client";

import { useEffect, useRef, useState } from "react";
import type { CropBox } from "@/lib/crop";

interface Props {
  videoId: string;
  time: number;
  crop: CropBox | null;
  playing: boolean;
}

/**
 * Debounced live preview of the exact cropped frame ffmpeg will take.
 * Fetched while paused; stays frozen (with a note) during playback.
 */
export function CropPreview({ videoId, time, crop, playing }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const urlRef = useRef<string | null>(null);

  const revoke = () => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setUrl(null);
  };

  useEffect(() => {
    revoke();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  useEffect(() => {
    if (!crop || playing) return;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch("/api/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ videoId, time, crop }),
        });
        if (!res.ok) throw new Error("preview failed");
        const blob = await res.blob();
        const u = URL.createObjectURL(blob);
        const prev = urlRef.current;
        if (prev) URL.revokeObjectURL(prev);
        urlRef.current = u;
        setUrl(u);
      } catch {
        // keep the last good preview
      } finally {
        setBusy(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [videoId, time, crop, playing]);

  return (
    <div className="panel flex h-44 items-center justify-center overflow-hidden p-2">
      {!crop ? (
        <span className="text-xs text-muted">draw a crop to preview the exact export frame</span>
      ) : playing ? (
        <span className="text-xs text-muted">preview frozen while playing</span>
      ) : url ? (
        <img
          src={url}
          alt="crop preview"
          className={`max-h-full max-w-full object-contain ${busy ? "opacity-50" : ""}`}
        />
      ) : (
        <span className="text-xs text-muted">rendering preview...</span>
      )}
    </div>
  );
}
