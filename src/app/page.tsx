"use client";

import { useEffect, useRef, useState } from "react";
import { ClipQueue } from "@/components/ClipQueue";
import { CropPreview } from "@/components/CropPreview";
import type { Aspect } from "@/components/CropOverlay";
import { JobsPanel } from "@/components/JobsPanel";
import { OptionsPanel } from "@/components/OptionsPanel";
import { Stage } from "@/components/Stage";
import { Timeline } from "@/components/Timeline";
import { VideoLoader } from "@/components/VideoLoader";
import type { TxtClip } from "@/lib/clipsTxt";
import { defaultClip, newId, type ClipSpec, type Job, type VideoInfo } from "@/lib/types";

const freshDraft = (v: VideoInfo): ClipSpec => ({
  ...defaultClip(),
  end: Math.max(0.5, Math.min(5, v.duration)),
});

export default function Page() {
  const [videos, setVideos] = useState<VideoInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [clips, setClips] = useState<Record<string, ClipSpec[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ClipSpec>(defaultClip);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Position before a clip-preview jump; restored by clicking inert
  // background, Esc, or the Back button in the transport row.
  const [returnTo, setReturnTo] = useState<number | null>(null);
  // The range is only "live" once the user sets it (timeline draw,
  // I/O keys, In/Out inputs). Without a range, playback is free.
  const [hasRange, setHasRange] = useState(false);
  const [aspect, setAspect] = useState<Aspect>("free");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const active = videos.find((v) => v.id === activeId) ?? null;
  const activeClips = active ? (clips[active.id] ?? []) : [];

  // Load sessions once; poll jobs every second (cheap on localhost).
  useEffect(() => {
    fetch("/api/videos")
      .then((r) => r.json())
      .then((vs: VideoInfo[]) => {
        setVideos(vs);
        if (vs[0]) {
          setActiveId(vs[0].id);
          setDraft(freshDraft(vs[0]));
        }
      })
      .catch(() => {});
    const poll = setInterval(async () => {
      try {
        const res = await fetch("/api/jobs");
        if (res.ok) setJobs(await res.json());
      } catch {
        // server restarting
      }
    }, 1000);
    return () => clearInterval(poll);
  }, []);

  const selectVideo = (id: string, v?: VideoInfo) => {
    const video = v ?? videos.find((x) => x.id === id);
    if (!video) return;
    setActiveId(id);
    setSelectedId(null);
    setPlaying(false);
    setTime(0);
    setExportError(null);
    setDraft(freshDraft(video));
    setReturnTo(null);
    setHasRange(false);
  };

  const onAdded = (v: VideoInfo) => {
    setVideos((all) => (all.some((x) => x.id === v.id) ? all : [...all, v]));
    selectVideo(v.id, v);
  };

  const removeVideo = (id: string) => {
    const v = videos.find((x) => x.id === id);
    if (v?.uploaded && !confirm(`Delete the uploaded file "${v.name}" from disk?`)) return;
    fetch(`/api/videos/${id}`, { method: "DELETE" }).catch(() => {});
    const rest = videos.filter((x) => x.id !== id);
    setVideos(rest);
    if (activeId === id) {
      if (rest[0]) selectVideo(rest[0].id);
      else {
        setActiveId(null);
        setReturnTo(null);
        setClips((all) => {
          const next = { ...all };
          delete next[id];
          return next;
        });
      }
    }
  };

  const seek = (t: number) => {
    const v = videoRef.current;
    if (!v || !active) return;
    v.currentTime = Math.max(0, Math.min(t, active.duration));
    setTime(v.currentTime);
  };

  const togglePlay = (p: boolean) => {
    const v = videoRef.current;
    if (!v) return;
    if (p) {
      // Playing accepts the preview position as the new one.
      setReturnTo(null);
      void v.play();
    } else {
      v.pause();
    }
  };

  // Loop the range while playing - only when a range is live.
  const onTime = (t: number) => {
    if (playing && hasRange && draft.end > draft.start && t >= draft.end) {
      seek(draft.start);
      return;
    }
    setTime(t);
  };

  const updateDraft = (patch: Partial<ClipSpec>) => {
    setDraft((d) => ({ ...d, ...patch }));
    if (selectedId && activeId) {
      setClips((all) => ({
        ...all,
        [activeId]: (all[activeId] ?? []).map((c) => (c.id === selectedId ? { ...c, ...patch } : c)),
      }));
    }
  };

  const setIn = (t: number) => {
    setReturnTo(null);
    seek(t);
    setHasRange(true);
    const dur = active?.duration ?? t;
    const start = Math.max(0, Math.min(t, dur - 0.2));
    const end = Math.min(dur, Math.max(start + 0.2, draft.end));
    updateDraft({ start, end });
  };

  const setOut = (t: number) => {
    setReturnTo(null);
    seek(t);
    setHasRange(true);
    const dur = active?.duration ?? t;
    const end = Math.max(0.2, Math.min(t, dur));
    const start = Math.max(0, Math.min(draft.start, end - 0.2));
    updateDraft({ start, end });
  };

  // Timeline drag draws a new range (live while dragging).
  const onDraw = (a: number, b: number) => {
    setReturnTo(null);
    setHasRange(true);
    const dur = active?.duration ?? b;
    const start = Math.max(0, Math.min(a, dur - 0.2));
    const end = Math.min(dur, Math.max(b, start + 0.2));
    updateDraft({ start, end });
  };

  // Right-click on the range clears it (back to free playback).
  const clearRange = () => setHasRange(false);

  const selectClip = (id: string) => {
    const c = activeClips.find((x) => x.id === id);
    if (!c) return;
    setSelectedId(id);
    setDraft({
      ...c,
      formats: [...c.formats],
      quality: { ...c.quality },
      gif: { ...c.gif },
      crop: c.crop ? { ...c.crop } : null,
    });
    setHasRange(true);
    // Jump to the clip's start for a preview; remember where we were
    // before the first jump so "back" can restore it.
    if (returnTo === null) setReturnTo(videoRef.current?.currentTime ?? time);
    seek(c.start);
  };

  // Leaving a clip preview: restore the previous position (if any),
  // deselect the clip, and clear its range back to free playback.
  const leavePreview = () => {
    const v = videoRef.current;
    if (returnTo !== null && v) v.currentTime = returnTo;
    setReturnTo(null);
    setSelectedId(null);
    setHasRange(false);
    if (active) setDraft(freshDraft(active));
  };

  // A click on inert background leaves the preview the same way as
  // Esc. Clicks on the clips list, the player (stage + timeline), and
  // any control count as "doing something else".
  useEffect(() => {
    if (returnTo === null) return;
    const onDocClick = (e: MouseEvent) => {
      const el = e.target;
      if (
        el instanceof Element &&
        el.closest("[data-clips-panel], [data-player], button, input, a, select, textarea")
      )
        return;
      leavePreview();
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [returnTo]);

  const addClip = () => {
    if (!activeId || !hasRange) return;
    const c: ClipSpec = {
      ...draft,
      id: newId(),
      formats: [...draft.formats],
      quality: { ...draft.quality },
      gif: { ...draft.gif },
      crop: draft.crop ? { ...draft.crop } : null,
    };
    setClips((all) => ({ ...all, [activeId]: [...(all[activeId] ?? []), c] }));
    setSelectedId(c.id);
  };

  // Add parsed clip ranges (from a Clips .txt) to the active video,
  // clamped to its duration.
  const importClips = (raw: TxtClip[]) => {
    if (!activeId || !active) return;
    const list = raw
      .map((r) => ({
        ...defaultClip(r.note),
        start: r.start,
        end: Math.min(r.end, active.duration),
      }))
      .filter((c) => c.start < active.duration && c.end - c.start > 0.2);
    if (!list.length) return;
    setClips((all) => ({ ...all, [activeId]: [...(all[activeId] ?? []), ...list] }));
  };

  const deleteClip = (id: string) => {
    if (!activeId) return;
    const rest = (clips[activeId] ?? []).filter((c) => c.id !== id);
    setClips((all) => ({ ...all, [activeId]: rest }));
    if (selectedId === id) {
      if (rest[0]) selectClip(rest[0].id);
      else {
        setSelectedId(null);
        setHasRange(false);
      }
    }
  };

  const exportAll = async () => {
    if (!active) return;
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoId: active.id, clips: activeClips }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? res.statusText);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const clearFinished = () => {
    fetch("/api/jobs", { method: "DELETE" }).then((r) => r.json()).then(setJobs).catch(() => {});
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-[1500px] flex-col gap-3 p-4">
      <header className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-lg font-semibold tracking-tight">clipmaker</h1>
        <span className="chip">local video clip editor</span>
        <span className="ml-auto font-mono text-[11px] text-muted">
          space play/pause &middot; I/O in-out &middot; arrows seek &middot; shift+arrow = 1 frame &middot; esc back
        </span>
      </header>

      <VideoLoader
        videos={videos}
        activeId={activeId}
        onSelect={(id) => selectVideo(id)}
        onRemove={removeVideo}
        activeName={active?.name ?? null}
        onAdded={onAdded}
        onLoadClips={importClips}
      />

      {active ? (
        <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-w-0 flex-col gap-3">
            <Stage
              src={`/api/videos/${active.id}/file`}
              srcW={active.width}
              srcH={active.height}
              videoRef={videoRef}
              time={time}
              playing={playing}
              duration={active.duration}
              fps={active.fps}
              inPoint={hasRange ? draft.start : null}
              outPoint={hasRange ? draft.end : null}
              crop={draft.crop}
              aspect={aspect}
              onTogglePlay={togglePlay}
              onPlayingChange={setPlaying}
              onTime={onTime}
              onSeek={seek}
              onIn={setIn}
              onOut={setOut}
              onCropChange={(c) => updateDraft({ crop: c })}
              returnTo={returnTo}
              onBack={leavePreview}
            />
            <Timeline
              duration={active.duration}
              time={time}
              inPoint={hasRange ? draft.start : null}
              outPoint={hasRange ? draft.end : null}
              onScrub={(t) => {
                setReturnTo(null);
                seek(t);
              }}
              onIn={setIn}
              onOut={setOut}
              onMoveSel={(a, b) => updateDraft({ start: a, end: b })}
              onDraw={onDraw}
              onClearRange={clearRange}
            />
            <CropPreview videoId={active.id} time={time} crop={draft.crop} playing={playing} />
          </div>
          <div className="flex flex-col gap-3">
            <OptionsPanel
              video={active}
              draft={draft}
              inOut={hasRange ? { start: draft.start, end: draft.end } : null}
              aspect={aspect}
              onChange={updateDraft}
              onAspect={setAspect}
              onClearCrop={() => updateDraft({ crop: null })}
            />
            <ClipQueue
              clips={activeClips}
              selectedId={selectedId}
              exporting={exporting}
              canAdd={hasRange}
              exportError={exportError}
              onAdd={addClip}
              onSelect={selectClip}
              onDelete={deleteClip}
              onExport={exportAll}
            />
            <JobsPanel jobs={jobs.filter((j) => j.videoId === active.id)} onClear={clearFinished} />
          </div>
        </div>
      ) : (
        <div className="panel flex flex-1 items-center justify-center p-16 text-sm text-muted">
          load a video above to start clipping
        </div>
      )}
    </div>
  );
}
