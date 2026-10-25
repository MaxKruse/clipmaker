"use client";

import { useRef, useState } from "react";
import {
  parseClipsTxt,
  sectionForVideo,
  type TxtClip,
} from "@/lib/clipsTxt";
import { humanSize } from "@/lib/human";
import { formatShort } from "@/lib/times";
import type { VideoInfo } from "@/lib/types";

interface Props {
  videos: VideoInfo[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onAdded: (v: VideoInfo) => void;
  /** Name of the active video, for matching section headers. */
  activeName: string | null;
  /** Called with parsed clip ranges to add to the active video. */
  onLoadClips: (clips: TxtClip[]) => void;
}

export function VideoLoader({
  videos, activeId, activeName, onSelect, onRemove, onAdded, onLoadClips,
}: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const txtRef = useRef<HTMLInputElement | null>(null);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const fail = (text: string) => setMsg({ text, ok: false });

  const upload = async (f: File) => {
    setBusy(f.name);
    setMsg(null);
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
      fail(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const addPath = async () => {
    const p = path.trim();
    if (!p) return;
    setBusy(p);
    setMsg(null);
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
      fail(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const importClipsFile = async (f: File) => {
    if (!activeName) {
      fail("select a video first - imported clips are added to the active video");
      return;
    }
    setMsg(null);
    try {
      const { sections } = parseClipsTxt(await f.text());
      const withClips = sections.filter((s) => s.clips.length > 0);
      if (withClips.length === 0) {
        fail(`no clip ranges found in ${f.name}`);
        return;
      }
      let chosen = withClips;
      if (withClips.length > 1) {
        // Multi-VOD note files: only import the section matching this video.
        const hit = sectionForVideo(sections, activeName);
        if (!hit) {
          fail(
            `${f.name} has ${withClips.length} video sections and none matches "${activeName}" - open that VOD and retry`,
          );
          return;
        }
        chosen = [hit];
      }
      const total = chosen.reduce((n, s) => n + s.clips.length, 0);
      onLoadClips(chosen.flatMap((s) => s.clips));
      setMsg({ text: `imported ${total} clips from ${f.name}`, ok: true });
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
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
        <button className="btn btn-sm" onClick={() => txtRef.current?.click()} disabled={Boolean(busy)}>
          Clips (.txt)
        </button>
        <input
          ref={txtRef}
          type="file"
          accept=".txt,text/plain"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importClipsFile(f);
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
      {msg && (
        <span className={`text-xs break-words ${msg.ok ? "text-ok" : "text-danger"}`}>
          {msg.text}
        </span>
      )}
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
