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
  const [cropMode, setCropMode] = useState(false);
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
    setCropMode(false);
    setPlaying(false);
    setTime(0);
    setExportError(null);
    setDraft(freshDraft(video));
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
    if (p) void v.play();
    else v.pause();
  };

  // Loop the selection while playing.
  const onTime = (t: number) => {
    if (playing && draft.end > draft.start && t >= draft.end) {
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
    seek(t);
    updateDraft({ start: Math.max(0, Math.min(t, draft.end - 0.2)) });
  };

  const setOut = (t: number) => {
    seek(t);
    updateDraft({ end: Math.min(active?.duration ?? t, Math.max(t, draft.start + 0.2)) });
  };

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
    setCropMode(Boolean(c.crop));
  };

  const addClip = () => {
    if (!activeId) return;
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

  const deleteClip = (id: string) => {
    if (!activeId) return;
    const rest = (clips[activeId] ?? []).filter((c) => c.id !== id);
    setClips((all) => ({ ...all, [activeId]: rest }));
    if (selectedId === id) {
      if (rest[0]) selectClip(rest[0].id);
      else {
        setSelectedId(null);
        if (active) setDraft(freshDraft(active));
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
          space play/pause &middot; I/O in-out &middot; arrows seek &middot; shift+arrow = 1 frame
        </span>
      </header>

      <VideoLoader
        videos={videos}
        activeId={activeId}
        onSelect={(id) => selectVideo(id)}
        onRemove={removeVideo}
        onAdded={onAdded}
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
              inPoint={draft.start}
              outPoint={draft.end}
              crop={draft.crop}
              cropMode={cropMode}
              aspect={aspect}
              onTogglePlay={togglePlay}
              onPlayingChange={setPlaying}
              onTime={onTime}
              onSeek={seek}
              onIn={setIn}
              onOut={setOut}
              onCropChange={(c) => updateDraft({ crop: c })}
            />
            <Timeline
              duration={active.duration}
              time={time}
              inPoint={draft.start}
              outPoint={draft.end}
              onScrub={seek}
              onIn={setIn}
              onOut={setOut}
              onMoveSel={(a, b) => updateDraft({ start: a, end: b })}
            />
            <CropPreview videoId={active.id} time={time} crop={draft.crop} playing={playing} />
          </div>
          <div className="flex flex-col gap-3">
            <OptionsPanel
              video={active}
              draft={draft}
              cropMode={cropMode}
              aspect={aspect}
              onChange={updateDraft}
              onToggleCropMode={() => {
                const next = !cropMode;
                setCropMode(next);
                if (next && playing) togglePlay(false);
              }}
              onAspect={setAspect}
              onClearCrop={() => {
                setCropMode(false);
                updateDraft({ crop: null });
              }}
            />
            <ClipQueue
              clips={activeClips}
              selectedId={selectedId}
              exporting={exporting}
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
