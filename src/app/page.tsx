"use client";

import { useEffect, useReducer, useRef, useState, type CSSProperties, type RefObject } from "react";
import { ClipQueue } from "@/components/ClipQueue";
import type { Aspect } from "@/components/CropOverlay";
import { ExportModal } from "@/components/ExportModal";
import { ExportPlanModal } from "@/components/ExportPlanModal";
import { ExportPill } from "@/components/ExportPill";
import { Filmstrip } from "@/components/Filmstrip";
import { OptionsPanel } from "@/components/OptionsPanel";
import { Resizer } from "@/components/Resizer";
import { Stage } from "@/components/Stage";
import { Timeline } from "@/components/Timeline";
import { useExportView } from "@/components/useExportView";
import { VideoModal } from "@/components/VideoModal";
import { initialPlayhead } from "@/lib/clips";
import type { TxtClip } from "@/lib/clipsTxt";
import { clipSessionReducer, initialClipSession } from "@/lib/clipSession";
import { LAYOUT_LIMITS, defaultLayout, loadLayout, saveLayout, type SeamKey, type WorkLayout } from "@/lib/layout";
import { isActiveJob } from "@/lib/jobs";
import { MIN_CLIP_SECONDS, defaultClip, defaultClipDefaults, newId, type ClipDefaults, type ClipSpec, type Job, type VideoInfo } from "@/lib/types";

const freshDraft = (v: VideoInfo, d: ClipDefaults): ClipSpec => ({
  ...defaultClip("", d),
  end: Math.max(0.5, Math.min(5, v.duration)),
});

// localStorage key for the resizable work-area layout.
const LAYOUT_KEY = "clipmaker.layout.v1";

export default function Page() {
  const [videos, setVideos] = useState<VideoInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [clips, setClips] = useState<Record<string, ClipSpec[]>>({});
  // The video whose project file has loaded; the single load gate: it
  // keeps the clip list from showing the previous video's clips on a
  // switch, and it keeps the save effect from writing a record that has
  // not been loaded yet (the initial empty one).
  const [clipsLoadedFor, setClipsLoadedFor] = useState<string | null>(null);
  const [draft, setDraft] = useState<ClipSpec>(defaultClip);
  // Export options for NEW and imported clips (persisted in .data/defaults.json).
  const [defaults, setDefaults] = useState<ClipDefaults>(defaultClipDefaults);
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;
  const [jobs, setJobs] = useState<Job[]>([]);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  // The clip session: the previewed clip, the "back" position (restored
  // by clicking inert background, Esc, or Back), the timeline focus, the
  // live in/out range, and the guided add-clip step (transition rules in
  // lib/clipSession.ts).
  const [session, dispatch] = useReducer(clipSessionReducer, initialClipSession);
  const [aspect, setAspect] = useState<Aspect>("free");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // The export plan modal (opened by "Export clips"): the clip list with
  // checkboxes + the combine toggle, instead of auto-starting the export.
  const [exportPlan, setExportPlan] = useState(false);
  // What the page-load ingest sweep did (null when it found nothing).
  const [ingestMsg, setIngestMsg] = useState<{ text: string; ok: boolean } | null>(null);
  // The video manager modal (loaded list + add/import) is collapsed behind
  // a single top-bar button so the work area keeps its real estate.
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  // The work-area layout: right column width plus the stage / filmstrip
  // / options panel heights (null = natural content height). The seams
  // between the regions resize it; persisted to localStorage so the
  // arrangement survives reloads.
  const [layout, setLayout] = useState<WorkLayout>(() =>
    loadLayout(() => {
      try {
        return window.localStorage.getItem(LAYOUT_KEY);
      } catch {
        return null;
      }
    }),
  );
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Clips waiting to reach disk. The debounced timer is cleared when the
  // save effect re-runs (a video switch), so the payload lives here and
  // gets flushed on switch and on unload instead of being dropped.
  const pendingSave = useRef<{ id: string; body: string } | null>(null);
  const flushPendingSave = () => {
    const p = pendingSave.current;
    if (!p) return;
    pendingSave.current = null;
    fetch(`/api/videos/${p.id}/clips`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: p.body,
      keepalive: true,
    }).catch(() => {});
  };

  // Seam dragging: a panel starts at its natural height, which is only
  // known by measuring it, so each drag records its start size here and
  // every move applies the total delta from that base.
  const stageWrap = useRef<HTMLDivElement | null>(null);
  const stripWrap = useRef<HTMLDivElement | null>(null);
  const optsWrap = useRef<HTMLDivElement | null>(null);
  const seamBase = useRef<Partial<Record<SeamKey, number>>>({});

  const persistLayout = (l: WorkLayout) =>
    saveLayout((s) => {
      try {
        window.localStorage.setItem(LAYOUT_KEY, s);
      } catch {
        // storage blocked - the layout stays in memory
      }
    }, l);

  const startSeam = (key: SeamKey, el?: RefObject<HTMLDivElement | null>, fallback = 0) => () => {
    seamBase.current[key] = key === "right" ? layout.right : el?.current?.offsetHeight ?? fallback;
  };
  const moveSeam = (key: SeamKey) => (total: number) => {
    const base = seamBase.current[key];
    if (base == null) return;
    const [lo, hi] = LAYOUT_LIMITS[key];
    // Stage and options sit above their seam, so they grow with the
    // drag; the filmstrip and the right column sit on the far side of
    // their seam, so the same drag shrinks them.
    const delta = key === "strip" || key === "right" ? -total : total;
    setLayout((l) => ({ ...l, [key]: Math.max(lo, Math.min(hi, base + delta)) }));
  };
  const resetSeam = (key: SeamKey) => () => {
    const next: WorkLayout = key === "right" ? { ...layout, right: defaultLayout.right } : { ...layout, [key]: null };
    setLayout(next);
    persistLayout(next);
  };

  const active = videos.find((v) => v.id === activeId) ?? null;
  // The list for the video whose project file has actually loaded: a
  // switch shows empty until the fetch lands, never the old video's clips.
  const activeClips = active && clipsLoadedFor === active.id ? clips[active.id] ?? [] : [];
  const selectedId = session.clipId;
  const hasRange = session.hasRange;
  const activeJobs = jobs.filter(isActiveJob);
  // The export view: front-and-center modal while a batch runs,
  // minimizable to a corner pill (transition rules in lib/exportView.ts).
  const exportView = useExportView(activeJobs.length);

  // Load sessions once; poll jobs every second (cheap on localhost). The
  // videos endpoint also runs the ingest-folder sweep, so a drop into
  // ingest/ lands here on the next navigation/refresh.
  useEffect(() => {
    fetch("/api/defaults")
      .then((r) => r.json())
      .then((d: ClipDefaults) => setDefaults(d))
      .catch(() => {});
    fetch("/api/videos")
      .then((r) => r.json())
      .then((j: {
        videos: VideoInfo[];
        ingested: { name: string; id: string }[];
        rejected: { name: string; reason: string }[];
        pending: string[];
        notice: string | null;
      }) => {
        setVideos(j.videos);
        // A freshly ingested video is what the user just dropped: make it
        // active (the last one when several arrived), else the first video.
        const last = j.ingested.length ? j.ingested[j.ingested.length - 1] : null;
        const first = last ? j.videos.find((v) => v.id === last.id) : j.videos[0];
        if (first) {
          setActiveId(first.id);
          // defaultsRef: the mount effect's closure captures the initial
          // render; the persisted defaults may have landed in the meantime.
          setDraft(freshDraft(first, defaultsRef.current));
        }
        if (j.notice) setIngestMsg({ text: j.notice, ok: j.rejected.length === 0 });
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

  // Load the active video's project file (its clips) on switch.
  useEffect(() => {
    if (!activeId) return;
    const id = activeId;
    let alive = true;
    fetch(`/api/videos/${id}/clips`)
      .then((r) => r.json())
      .then((j: { clips: ClipSpec[] }) => {
        if (!alive) return;
        setClips((all) => ({ ...all, [id]: j.clips ?? [] }));
        setClipsLoadedFor(id);
        // Land the playhead on the first clip (not the boring 0:00) as soon
        // as the project file lands and the video element is ready. No clips
        // means 0, which is already where the video starts.
        const v = videoRef.current;
        const video = videos.find((x) => x.id === id);
        if (v && video) {
          const t = initialPlayhead(j.clips ?? [], video.duration);
          const apply = () => {
            if (!alive) return;
            v.currentTime = t;
            setTime(t);
          };
          if (v.readyState >= 1) apply();
          else v.addEventListener("loadedmetadata", apply, { once: true });
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [activeId]);

  // Save the active video's clips, debounced after every change.
  useEffect(() => {
    // A video switch clears the timer, so the pending payload would be
    // dropped: when it belongs to the old video, send it now.
    if (pendingSave.current && pendingSave.current.id !== activeId) flushPendingSave();
    if (!activeId || clipsLoadedFor !== activeId) return;
    pendingSave.current = {
      id: activeId,
      body: JSON.stringify({ clips: clips[activeId] ?? [] }),
    };
    const h = setTimeout(flushPendingSave, 500);
    return () => clearTimeout(h);
  }, [clips, activeId, clipsLoadedFor]);

  // A tab close takes the debounce timer with it, so flush what is still
  // pending; keepalive lets the request outlive the document.
  useEffect(() => {
    const onLeave = () => flushPendingSave();
    window.addEventListener("pagehide", onLeave);
    return () => window.removeEventListener("pagehide", onLeave);
  }, []);

  const selectVideo = (id: string, v?: VideoInfo) => {
    const video = v ?? videos.find((x) => x.id === id);
    if (!video) return;
    setActiveId(id);
    dispatch({ type: "video-changed" });
    setPlaying(false);
    setTime(0);
    setExportError(null);
    setDraft(freshDraft(video, defaults));
  };

  const onAdded = (v: VideoInfo) => {
    setVideos((all) => (all.some((x) => x.id === v.id) ? all : [...all, v]));
    selectVideo(v.id, v);
  };

  const removeVideo = (id: string) => {
    const v = videos.find((x) => x.id === id);
    if (!v) return;
    // Every removal deletes the video's export files; uploaded sources
    // are deleted from disk too, path sources are not.
    const text = v.uploaded
      ? `Delete "${v.name}" and its export files from disk?`
      : `Delete "${v.name}"? Its export files are deleted from disk; the source video is kept.`;
    if (!confirm(text)) return;
    fetch(`/api/videos/${id}`, { method: "DELETE" }).catch(() => {});
    setClips((all) => {
      const next = { ...all };
      delete next[id];
      return next;
    });
    const rest = videos.filter((x) => x.id !== id);
    setVideos(rest);
    if (activeId === id) {
      if (rest[0]) selectVideo(rest[0].id);
      else {
        // No video left: the work area unmounts, and the next select
        // starts a fresh session anyway.
        setActiveId(null);
        dispatch({ type: "video-changed" });
      }
    }
  };

  const seek = (t: number) => {
    const v = videoRef.current;
    if (!v || !active) return;
    v.currentTime = Math.max(0, Math.min(t, active.duration));
    setTime(v.currentTime);
  };

  // Persist the new-clip defaults (small file, fire and forget).
  const saveDefaults = (d: ClipDefaults) => {
    setDefaults(d);
    fetch("/api/defaults", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(d),
    }).catch(() => {});
  };

  const togglePlay = (p: boolean) => {
    const v = videoRef.current;
    if (!v) return;
    if (p) {
      // Playing accepts the preview position as the new one.
      dispatch({ type: "cancel-return" });
      void v.play();
    } else {
      v.pause();
    }
  };

  // While a range is dragged (in/out handles, move, draw) suspend
  // playback so the frame under the pointer stays still; the
  // pre-drag playing state is restored on release.
  const dragSuspended = useRef(false);
  const onDragChange = (dragging: boolean) => {
    const v = videoRef.current;
    if (!v) return;
    if (dragging) {
      if (!v.paused) {
        dragSuspended.current = true;
        v.pause();
      }
    } else if (dragSuspended.current) {
      dragSuspended.current = false;
      void v.play();
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
    // Guided flow: touching the times finishes the "set the times"
    // step; setting a crop finishes the optional crop step.
    dispatch({ type: "patched", patch });
    setDraft((d) => ({ ...d, ...patch }));
    if (selectedId && activeId) {
      setClips((all) => ({
        ...all,
        [activeId]: (all[activeId] ?? []).map((c) => (c.id === selectedId ? { ...c, ...patch } : c)),
      }));
    }
  };

  const setIn = (t: number) => {
    dispatch({ type: "set-range" });
    seek(t);
    const dur = active?.duration ?? t;
    const start = Math.max(0, Math.min(t, dur - MIN_CLIP_SECONDS));
    const end = Math.min(dur, Math.max(start + MIN_CLIP_SECONDS, draft.end));
    updateDraft({ start, end });
  };

  const setOut = (t: number) => {
    dispatch({ type: "set-range" });
    seek(t);
    const dur = active?.duration ?? t;
    const end = Math.max(MIN_CLIP_SECONDS, Math.min(t, dur));
    const start = Math.max(0, Math.min(draft.start, end - MIN_CLIP_SECONDS));
    updateDraft({ start, end });
  };

  // Timeline drag draws a new range (live while dragging).
  const onDraw = (a: number, b: number) => {
    dispatch({ type: "set-range" });
    const dur = active?.duration ?? b;
    const start = Math.max(0, Math.min(a, dur - MIN_CLIP_SECONDS));
    const end = Math.min(dur, Math.max(b, start + MIN_CLIP_SECONDS));
    updateDraft({ start, end });
  };

  // Right-click on the range clears it (back to free playback).
  const clearRange = () => dispatch({ type: "clear-range" });

  const selectClip = (id: string) => {
    const c = activeClips.find((x) => x.id === id);
    if (!c) return;
    // Jump to the clip's start for a preview; the session remembers
    // where we were before the first jump so "back" can restore it.
    dispatch({
      type: "select-clip",
      clipId: id,
      start: c.start,
      end: c.end,
      playhead: videoRef.current?.currentTime ?? time,
    });
    setDraft({
      ...c,
      formats: [...c.formats],
      quality: { ...c.quality },
      anim: { ...c.anim },
      crop: c.crop ? { ...c.crop } : null,
    });
    seek(c.start);
  };

  // Leaving a clip preview: restore the previous position (if any),
  // deselect the clip, and clear its range back to free playback.
  const leavePreview = () => {
    // Esc and Back are preview controls: with no clip under preview there
    // is nothing to leave, and the draft's in/out must survive the keypress.
    if (session.clipId === null) return;
    const v = videoRef.current;
    if (session.returnTo !== null && v) v.currentTime = session.returnTo;
    dispatch({ type: "leave-preview" });
    if (active) setDraft(freshDraft(active, defaults));
  };

  // A click on inert background leaves the preview the same way as
  // Esc. Clicks on the clips list, the player (stage + timeline), and
  // any control count as "doing something else".
  useEffect(() => {
    if (session.returnTo === null) return;
    const onDocClick = (e: MouseEvent) => {
      const el = e.target;
      if (
        el instanceof Element &&
        el.closest("[data-clips-panel], [data-clip-options], [data-player], [data-layout], button, input, a, select, textarea")
      )
        return;
      leavePreview();
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [session.returnTo]);

  // Start the add-clip flow: the clip is created immediately - at the
  // live range if there is one, otherwise as a short window at the
  // playhead - and selected, so every following change (times, crop,
  // options) edits it in place and saves automatically.
  const addClip = () => {
    if (!activeId || !active) return;
    const c: ClipSpec = {
      ...draft,
      id: newId(),
      formats: [...draft.formats],
      quality: { ...draft.quality },
      anim: { ...draft.anim },
      crop: draft.crop ? { ...draft.crop } : null,
    };
    if (!hasRange) {
      c.start = Math.max(0, Math.min(time, active.duration - MIN_CLIP_SECONDS));
      c.end = Math.min(active.duration, c.start + 5);
    }
    setClips((all) => ({ ...all, [activeId]: [...(all[activeId] ?? []), c] }));
    setDraft({ ...c, formats: [...c.formats], quality: { ...c.quality }, anim: { ...c.anim }, crop: c.crop ? { ...c.crop } : null });
    dispatch({ type: "add-clip", clipId: c.id });
  };

  // Add parsed clip ranges (from a Clips .txt) to the active video,
  // clamped to its duration.
  const importClips = (raw: TxtClip[]) => {
    if (!activeId || !active) return;
    const list = raw
      .map((r) => ({
        ...defaultClip(r.note, defaults),
        start: r.start,
        end: Math.min(r.end, active.duration),
      }))
      .filter((c) => c.start < active.duration && c.end - c.start > MIN_CLIP_SECONDS);
    if (!list.length) return;
    setClips((all) => ({ ...all, [activeId]: [...(all[activeId] ?? []), ...list] }));
    dispatch({ type: "imported" });
  };

  const deleteClip = (id: string) => {
    if (!activeId) return;
    const rest = (clips[activeId] ?? []).filter((c) => c.id !== id);
    setClips((all) => ({ ...all, [activeId]: rest }));
    if (selectedId === id) {
      if (rest[0]) selectClip(rest[0].id);
      else dispatch({ type: "deselect" });
    }
  };

  // Enqueue the export the plan modal approved: `combine` groups
  // same-name clips into one job each (a single mp4 "highlights" file,
  // parts concatenated with fades). Success opens the progress modal.
  const startExport = async (selected: ClipSpec[], combine: boolean) => {
    if (!active) return;
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoId: active.id, clips: selected, combine }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? res.statusText);
      setExportPlan(false);
      exportView.show();
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const clearFinished = () => {
    fetch("/api/jobs", { method: "DELETE" })
      .then(() => fetch("/api/jobs"))
      .then((r) => r.json())
      .then((j: Job[]) => {
        setJobs(j);
        // The clear deletes every settled job, so the refetch is the
        // running set or nothing: the modal has nothing left to show.
        exportView.dismiss();
      })
      .catch(() => {});
  };

  const cancelOne = (id: string) => {
    // Cancel the job server-side, then refresh so the row flips to the
    // settled (error: "cancelled by user") state.
    fetch(`/api/jobs/${id}`, { method: "DELETE" })
      .then(() => fetch("/api/jobs"))
      .then((r) => r.json())
      .then((j: Job[]) => setJobs(j))
      .catch(() => {});
  };

  return (
    <div className="flex min-h-screen flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-sm min-w-0 max-w-full" onClick={() => setVideoModalOpen(true)}>
          <span className="min-w-0 max-w-[520px] truncate">
            {active ? active.name : "load a video"}
          </span>
        </button>
        {ingestMsg && (
          <span className={`text-xs break-words ${ingestMsg.ok ? "text-ok" : "text-danger"}`}>
            {ingestMsg.text}
          </span>
        )}
      </div>

      {/* The work area (xl and up) is a resizable grid: the seam
          between two regions is a draggable grip (Resizer) - drag
          to resize, double-click to reset. The sizes feed the grid
          templates through CSS variables (unset = natural/auto). */}
      {active ? (
        <div
          className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_auto_var(--lm-col,400px)] xl:gap-0"
          style={
            {
              "--lm-col": `${layout.right}px`,
              "--lm-stage": layout.stage ? `${layout.stage}px` : undefined,
              "--lm-strip": layout.strip ? `${layout.strip}px` : undefined,
              "--lm-opts": layout.options ? `${layout.options}px` : undefined,
            } as CSSProperties
          }
        >
          <div className="flex min-w-0 flex-col gap-3 xl:grid xl:grid-rows-[var(--lm-stage,auto)_auto_auto_auto_var(--lm-strip,108px)] xl:gap-0">
            <div ref={stageWrap} className="min-h-0 min-w-0">
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
              returnTo={session.returnTo}
              onBack={leavePreview}
              glow={session.step === "crop"}
              fit={layout.stage !== null}
            />
            </div>
            <Resizer
              dir="row"
              onStart={startSeam("stage", stageWrap, 480)}
              onResize={moveSeam("stage")}
              onEnd={() => persistLayout(layout)}
              onReset={resetSeam("stage")}
            />
            <Timeline
              key={active.id}
              duration={active.duration}
              time={time}
              inPoint={hasRange ? draft.start : null}
              outPoint={hasRange ? draft.end : null}
              onScrub={(t) => {
                dispatch({ type: "cancel-return" });
                seek(t);
              }}
              onIn={setIn}
              onOut={setOut}
              onMoveSel={(a, b) => updateDraft({ start: a, end: b })}
              onDraw={onDraw}
              onDragChange={onDragChange}
              onClearRange={clearRange}
              glow={session.step === "set-times"}
              focus={session.focus}
            />
            <Resizer
              dir="row"
              onStart={startSeam("strip", stripWrap, 108)}
              onResize={moveSeam("strip")}
              onEnd={() => persistLayout(layout)}
              onReset={resetSeam("strip")}
            />
            <div ref={stripWrap} className="min-h-0 min-w-0">
            <Filmstrip videoId={active.id} onSeek={seek} />
            </div>
          </div>
          <Resizer
            dir="col"
            onStart={startSeam("right")}
            onResize={moveSeam("right")}
            onEnd={() => persistLayout(layout)}
            onReset={resetSeam("right")}
          />
          <div className="flex min-w-0 flex-col gap-3 xl:grid xl:grid-rows-[var(--lm-opts,auto)_auto_minmax(0,1fr)] xl:gap-0">
            <div ref={optsWrap} className="min-h-0 min-w-0">
            <OptionsPanel
              video={active}
              draft={draft}
              inOut={hasRange ? { start: draft.start, end: draft.end } : null}
              aspect={aspect}
              defaults={defaults}
              onChange={updateDraft}
              onDefaultsChange={saveDefaults}
              onAspect={setAspect}
              onClearCrop={() => updateDraft({ crop: null })}
            />
            </div>
            <Resizer
              dir="row"
              onStart={startSeam("options", optsWrap, 300)}
              onResize={moveSeam("options")}
              onEnd={() => persistLayout(layout)}
              onReset={resetSeam("options")}
            />
            <div className="min-h-0 min-w-0 flex-1">
            <ClipQueue
              clips={activeClips}
              selectedId={selectedId}
              exporting={exporting}
              attnAdd={selectedId === null}
              exportError={exportError}
              onAdd={addClip}
              onSelect={selectClip}
              onDelete={deleteClip}
              onExport={() => setExportPlan(true)}
            />
            </div>
          </div>
        </div>
      ) : (
        <div className="panel flex flex-1 items-center justify-center p-16 text-sm text-muted">
          load a video above to start clipping
        </div>
      )}
      {exportView.view === "modal" && jobs.length > 0 ? (
        <ExportModal jobs={jobs} onDismiss={exportView.dismiss} onClear={clearFinished} onCancel={cancelOne} />
      ) : (
        <ExportPill jobs={jobs} onView={exportView.show} />
      )}
      {exportPlan && active && (
        <ExportPlanModal
          clips={activeClips}
          videoFps={active.fps}
          onClose={() => setExportPlan(false)}
          onStart={startExport}
        />
      )}
      {videoModalOpen && (
        <VideoModal
          onClose={() => setVideoModalOpen(false)}
          videos={videos}
          activeId={activeId}
          onSelect={(id) => {
            selectVideo(id);
            setVideoModalOpen(false);
          }}
          onRemove={removeVideo}
          activeName={active?.name ?? null}
          onAdded={onAdded}
          onLoadClips={importClips}
        />
      )}
    </div>
  );
}
