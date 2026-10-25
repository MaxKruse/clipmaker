"use client";

import { useRef, useState } from "react";
import { humanSize } from "@/lib/human";
import { formatShort } from "@/lib/times";
import type { VideoInfo } from "@/lib/types";

interface Props {
  videos: VideoInfo[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onAdded: (v: VideoInfo) => void;
}

export function VideoLoader({ videos, activeId, onSelect, onRemove, onAdded }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async (f: File) => {
    setBusy(f.name);
    setError(null);
    try {
      // Send the File as a plain Blob body, not f.stream() + duplex:
      // Chromium's duplex fetch to the Bun dev server fails at the
      // connection level (ERR_ALPN_NEGOTIATION_FAILED). Blob bodies are
      // still streamed from disk by the browser, not read into memory.
      const res = await fetch("/api/videos", {
        method: "POST",
        headers: { "x-filename": encodeURIComponent(f.name) },
        body: f,
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? res.statusText);
      onAdded(j.video);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const addPath = async () => {
    const p = path.trim();
    if (!p) return;
    setBusy(p);
    setError(null);
    try {
      const res = await fetch("/api/videos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: p }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? res.statusText);
      onAdded(j.video);
      setPath("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="panel flex flex-col gap-2 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={Boolean(busy)}>
          Upload file
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          multiple
          className="hidden"
          onChange={(e) => {
            for (const f of Array.from(e.target.files ?? [])) void upload(f);
            e.target.value = "";
          }}
        />
        <input
          className="input min-w-64 flex-1 font-mono"
          placeholder="...or a local path, e.g. C:\Videos\my-vod.mp4"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void addPath();
          }}
        />
        <button className="btn btn-sm" onClick={addPath} disabled={Boolean(busy) || !path.trim()}>
          Add by path
        </button>
        {busy && <span className="chip">loading: {busy}</span>}
      </div>
      {error && <span className="text-xs break-words text-danger">{error}</span>}
      {videos.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {videos.map((v) => (
            <span
              key={v.id}
              className={`group flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                v.id === activeId
                  ? "border-accent/70 bg-accent/15 text-fg"
                  : "border-border bg-panel2 text-muted hover:border-accent/40"
              }`}
              onClick={() => onSelect(v.id)}
            >
              <span className="max-w-48 truncate">{v.name}</span>
              <span className="font-mono text-[10px]">
                {v.width}x{v.height} {formatShort(v.duration)} {humanSize(v.sizeBytes)}
              </span>
              <button
                className="text-muted hover:text-danger"
                title="remove"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(v.id);
                }}
              >
                x
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
