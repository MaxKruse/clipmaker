# AGENTS.md - clipmaker

Technical documentation for agents working on this codebase. User-facing
docs live in README.md; keep the two in sync when behavior changes.

**UI changes require a README screenshot reshoot.** The README's "At a
glance" section shows the use-case flow with the example cat video
(`docs/screenshot-1-add.png` ... `docs/screenshot-4-main.png`). When a
change alters the rendered interface (layout, components, labels,
colors), reshoot all four screenshots with the same cat video and
replace the PNGs, so the examples keep matching the live UI.

## What it is

A local web app that cuts clips from local videos and exports them as MP4
and/or GIF and/or animated AVIF (GIF/AVIF in a full tier plus a
size-capped sharable tier), or combined: clips sharing a note merged
into ONE MP4 highlights file (mp4 only, 0.5s fades per part). Next.js 15 App Router, React 19, TypeScript,
Tailwind v4
(hand-rolled UI components, no component library). All ffmpeg work runs
server-side via `child_process`; the browser only handles UI, preview
frames, and download links.

## Architecture

The code is layered so that everything testable is pure:

```
src/lib/times.ts    time parsing/formatting + frameAt + formatClipTime + clip focus window
src/lib/bitrate.ts  source-kbit detection + fps-scaled target kbit
src/lib/ladder.ts   GIF ping-pong shrink ladder (edge x fps rungs) + AVIF 3-axis ladder (edge x fps x crf) + sharableCap (maxEdge vs the full tier's longest edge, and the scale axis)
src/lib/names.ts    safe output file names (clip1-note.mp4, ...)
src/lib/vodDate.ts  broadcast date in a VOD file name -> dated video id
                    (<date>_<random> via newVideoId) + dateFromVideoId (id -> date)
src/lib/crop.ts     CropBox model, normalizeCrop (even, clamped, >=16px)
src/lib/clipsTxt.ts parse Clips .txt notes (time ranges + # sections) + the
                    inverse clipsTxtForVideo serializer (round trip pinned
                    by test/clipsTxt.test.ts)
src/lib/clips.ts    client-side sanitizers: toClip (untrusted clip -> ClipSpec) and
                    toDefaults (untrusted defaults -> ClipDefaults, field-wise
                    fallback to the shipped defaults)
src/lib/combine.ts  same-name grouping (groupCombine), combo math (duration,
                    0.5s fades, target size) for the MP4 highlights combine
src/lib/args.ts     ffmpeg argument builders (mp4/gif/avif stages/preview,
                    combo cut, concat)
src/lib/jobs.ts     export list display order (newest batch first, clip order within)
src/lib/stages.ts   structured export job stages (JobStage) + user-facing stage text
src/lib/exportView.ts export view state machine (modal | pill)
src/lib/clipSession.ts clip session state machine (preview, back position, focus, range, flow step)
src/lib/layout.ts     resizable work-area layout (WorkLayout, LAYOUT_LIMITS, clamp, load/save with injected IO)
src/lib/avif.ts       avifDurationLevel (length-based AVIF encode warning, 45s/60s) +
                    avifWarningText (the shared user-facing warning sentence)
src/lib/types.ts    VideoInfo, ClipSpec, ClipDefaults, Job, MIN_CLIP_SECONDS +
                    defaultClip(note, defaults) / defaultClipDefaults() /
                    toggleFormatIn (formats list, keeps at least one)
src/lib/human.ts    human sizes ("4.7 MB")
      -- everything above is pure and unit-tested (test/*.test.ts) --
src/lib/ffmpeg.ts   ffmpeg/ffprobe discovery + spawn wrappers,
                    probeVideo/ProbeResult (video metadata at load), progress,
                    encoder probes (nvenc, avif; one-shot via once()), and
                    the cancel registry (runTracked tracks each running
                    child, killProcessTree kills it) that lets the runner
                    interrupt a job mid-encode
src/lib/ingest.ts   ingest-folder sweep: pure helpers (shouldIngest,
                    quarantineName, classifyMoveFailure, ingestNotice) plus
                    the single-flight sweepIngest (server-only - the page
                    must never import it, only the videos route may)
src/lib/store.ts    disk-backed session store (.data/) + dir constants
src/lib/runner.ts   bounded export job pool (CLIPMAKER_CONCURRENCY, default 2; the only ffmpeg caller) + cancelJob (the only way to interrupt a queued/running job); runCombined is the combined-MP4 pipeline for jobs with job.clips
src/app/api/**      thin route handlers over store/runner
src/components/**   UI, all "use client"; useExportView.ts is the thin hook
                    around the exportView reducer
src/app/page.tsx    page state owner (videos, clips, draft, jobs polling); the
                    export view and clip session run as explicit machines
```

Key invariants:

- **`args.ts` builders are locked by their unit tests.** Changing the
  order or content of the generated ffmpeg arguments without updating
  `test/args.test.ts` breaks the suite. The tests pin the exact recipes.
- **One export batch = one createdAt stamp.** The export route stamps
  every job of one request with a single timestamp; `sortJobs` (jobs.ts)
  relies on stable tie order so a batch renders in clip order, and a
  newer batch renders above older ones.
- **The runner is the only place that spawns ffmpeg.** Routes and
  components never build ffmpeg commands themselves.
- **Crops are stored in source pixels** (`CropBox {x,y,w,h}`, all even,
  min 16px, clamped to the frame). The UI converts between screen px and
  source px via the measured frame rect; the preview route re-normalizes
  server-side, so a stale UI crop can never produce an invalid filter.
- **Progress events use `-progress pipe:1`**; both `run` and
  `runProgress` in ffmpeg.ts parse it. `runProgress` takes the expected
  total duration and reports 0..100.
- **Job stages are structured, not free strings.** The runner builds
  `JobStage` objects (stages.ts); the export modal renders them through
  `stageText`, whose wording is pinned by `test/stages.test.ts`.
  jobs.json rows with a legacy string stage migrate to null on load
  (store.ts:loadJobs).

## Data model

- `VideoInfo { id, name, path, uploaded, size, duration, width, height,
  fps, hasAudio, videoKbit, formatKbit }` - probed once at load.
  `uploaded` marks files copied into `uploads/` (safe to delete).
  `id` is generated by `newVideoId(basename)` (lib/vodDate.ts):
  `<date>_<random>` when the source file name carries a broadcast date
  (`YYYY-MM-DD`, e.g. Twitch/Kick downloader names, or a full 8-digit
  `YYYYMMDD` run), plain `<random>` otherwise. The date comes back out
  of the id via `dateFromVideoId`; videos registered before that stay
  on their legacy random id and flat layout.
- `ClipSpec { id, note, start, end, crop, formats, audio, fps, quality,
  anim }` - one clip. `formats` is a non-empty subset of
  `"mp4" | "gif" | "avif"`. `fps` (default 60; 25/30/60) is the MP4
  frame rate; `quality { mode: "source" | "manual", kbit }` applies to
  MP4; `anim { fps, maxMB, maxEdge }` (fps default 30; 15/20/25/30/60)
  applies to GIF/AVIF - `fps` is the shared intermediate's frame rate
  and the full tier's; `maxMB`/`maxEdge` cap the sharable tier (maxEdge
  options 256-1440; the ladder is capped at the source/crop longest edge
  and never upscales). New and imported clips are created by
  `defaultClip(note, defaults)` from the user's persisted
  `ClipDefaults` (shipped values: `formats: ["mp4", "avif"]`,
  `maxEdge: 1000`; the rest in `types.ts:defaultClipDefaults()`).
- `ClipDefaults { formats, audio, fps, quality, anim }` - the export
  options new and imported clips are created with; user-editable via
  the Defaults toggle in the OptionsPanel, persisted in
  `.data/defaults.json`, validated by `toDefaults` (lib/clips.ts).
  Existing clips keep their own settings.
- `Job { id, videoId, videoName, clip, clipNo, clips?, status, stage,
  pct, outputs, warning?, error?, createdAt }` - `clips` (present only
  on combined jobs) is the same-name group; the job produces ONE mp4
  highlights file, `clip`/`clipNo` = the group's first member (with
  `formats` forced to `["mp4"]` for display). `status` is
  queued/running/
  done/error. `stage` is the structured `JobStage` (stages.ts) while
  running, null when settled; the modal renders it via `stageText`.
  `outputs` is an array of `{ kind: "mp4" | "gif" | "avif",
  name, size, tier?: "full" | "sharable" }` for files under the video's
  export dir - `out/<videoId>/`, plus the `<date>` subfolder for dated
  ids (`name` may be a relative path like
  `sharable/clip1-note.gif`; `tier` is absent on old jobs).

## Disk layout (all gitignored, created lazily)

- `.data/videos.json`, `.data/jobs.json` - persisted session state.
- `.data/defaults.json` - new-clip defaults (`ClipDefaults`); created
  on first save, loaded through `toDefaults` so a corrupt file
  self-heals to the shipped defaults.
- `uploads/<videoId>/<name>` - uploaded files.
- `ingest/` - drop folder for huge files. Not created by the app (the
  user creates it, optionally at another location via
  `CLIPMAKER_INGEST_DIR`). The next page load moves proberable files
  into `uploads/<videoId>/` and registers them; unproberable files are
  quarantined into `ingest/failed/` with a `.err` sidecar; files still
  being written (size change during the probe, or the writer still
  locking them) are left in place and retried on the next page load.
- `out/<videoId>/...` - per-video export dir. Dated videos (see
  VideoInfo) put every export file in a subfolder of just that date:
  `out/<videoId>/<date>/clipN[-note].mp4|gif|avif` (full tier) and
  `out/<videoId>/<date>/sharable/` (sharable copies); undated and
  legacy videos keep the flat layout directly in `out/<videoId>/`.
  `timestamps.txt` (clips mirror) always sits at the video root.
- `.tmp/<jobId>/` - per-job temp files, deleted in a `finally`.

## Export recipes (ported from the clipmaker skill)

- **MP4**: input seek `-ss <start>`, output cut `-t <dur>`, always
  re-encode. `start` is `clip.start` floored to the frame grid
  (`frameAt` in times.ts), so the first output frame is the frame a
  player displays at the in-point, not the first frame after it.
  Video: nvenc (fullres VBR) when available, else libx264
  slow. Bitrate: source-matched by default
  (`targetVideoKbit(sourceKbit, srcFps, outFps)`), manual kbit allowed.
  Audio: AAC 192k with `asetpts,apad` when the source has audio and the
  clip keeps audio. After encoding, container+video durations are
  verified within 1.5 frames; one retry; a second miss becomes a
  `job.warning` (the file is kept).
- **GIF / AVIF dual tier** (never gif/avif-from-VOD): one shared
  full-res intermediate mp4 is cut first at the clip's frame (same
  floored start as the MP4, crop applied, at `anim.fps`) and feeds every
  tier. Each clip with gif and/or avif selected ALWAYS produces two
  versions per format: a **full** tier (full resolution - crop size if
  cropped, else source size - at `anim.fps`, uncapped, at the export
  dir root)
  and a **sharable** tier (its longest edge scaled to `anim.maxEdge` -
  `sharableCap` picks the axis, so a portrait crop scales the height -
  capped at `anim.maxMB`, in `sharable/`; sharable gif files carry the
  `-<maxEdge>` edge suffix).
  - **GIF**: shared `palettegen` from the full-res cut (256 colors,
    `stats_mode=full`); full tier = one stage-3 encode at full
    size@anim.fps, no cap; sharable tier = the ping-pong quality ladder:
    each edge step (maxEdge x 1.0, .75, .625, .5, .375, .25, even-floored,
    capped at the full tier's longest edge via sharableCap and scaled on
    that axis so it never upscales) is tried at
    anim.fps and then at 5/6 x anim.fps (the recipe's 30 -> 25), highest
    quality first, taking the first rung whose file is <= maxMB; an
    emergency 0.1875-edge rung at the stepped fps is tried last; if it
    still exceeds the cap the job fails.
  - **AVIF**: full tier = one crf30 encode at full size, no cap;
    sharable tier = the same 12-rung edge x fps
    ping-pong grid as the GIF, repeated per CRF step (25, 29, 33, 36 -
    CRF only changes after the whole grid is exhausted, 48 rungs),
    first file <= maxMB wins; an emergency maxEdge@anim.fps@crf40 rung
    is tried last; if it still exceeds the cap the job fails. Duration
    verify uses the winning rung's fps.
- **Combined MP4 (highlights)** (MP4 ONLY - a same-name group is ONE
  job producing ONE mp4 file, never gif/avif): per part (stage
  `combo-cut: part i/n`) a segment `tmp/seg-i.mp4` is cut at the part's
  floored frame with `buildComboCutArgs`: crop (if any) then
  scale/pad to the group's target size (`comboTarget` = first clip's
  crop-or-source size, so every part is the same size), `fps=N`,
  `fade=in`/`fade=out` over `comboFade(dur) = min(0.5s, dur/2)`,
  `setpts=PTS-STARTPTS`, libx264 ultrafast crf14 (the segments need to
  concat frame-accurate). Audio is per part: source audio with matching
  `afade` in/out (48kHz AAC), a silent `anullsrc` track when the part
  mutes audio, or none at all when the whole group has no audio. Then
  `buildConcatArgs` demuxer-concats the segments (a `concat.txt` list
  of `file '...'` lines) into the final mp4 with the normal mp4 video
  encoder (nvenc when available, else x264 slow) at the group's fps and
  quality (first clip's), `+faststart`; the final encode is
  duration-verified against `comboDuration` (sum of per-part durations)
  with one retry (stage `mp4-encode`). Output file: `clipN-note.mp4`
  where N = the group's first clip number.
- **Encoder choice** is probed once per kind and cached in-process:
  `nvencAvailable()` (a 320x180 testsrc probe-encode) and
  `avifEncoder()` (a 320x180 testsrc probe-encode into a `.avif`:
  `libsvtav1` preferred, `libaom-av1` fallback; null when neither works
  - AVIF jobs then fail with a clear error, MP4/GIF unaffected).

## API

- `POST /api/videos` - JSON `{path}` registers a local file (probed,
  referenced in place); a raw body (no multipart) with an `x-filename`
  header uploads it into `uploads/`. 64GB cap, backpressure handled.
- `GET /api/videos` - runs the ingest-folder sweep (`sweepIngest`,
  single-flight) and then returns
  `{ videos, ingested, rejected, pending, notice }`; `notice` is the
  one-line banner text (contract pinned by `test/ingest.test.ts`), null
  when the sweep found nothing. `DELETE /api/videos/[id]` - remove
  (deletes the upload dir only when `uploaded`).
- `GET /api/videos/[id]/file` - byte-range streaming (206); the `<video>`
  element needs this for seeking.
- `GET/PUT /api/videos/[id]/clips` - the video's project file: fetch
  the persisted clip list, or replace it (every clip validated through
  `toClip` in `lib/clips.ts`, max 500 clips). 404 for unknown videos.
  GET re-runs stored rows through `toClip`, so legacy shapes (the old
  `gif` key) self-migrate to `anim` on read. PUT also mirrors the list
  to `out/<videoId>/timestamps.txt` (one `<start> - <end> <note>` line
  per clip via `timestampsForVideo`) - best-effort: an empty list
  deletes the file, and a failed write never fails the save.
- `GET/PUT /api/defaults` - the new-clip defaults: GET returns the
  `ClipDefaults` object directly; PUT sanitizes the body through
  `toDefaults`, persists it to `.data/defaults.json`, and returns
  `{ok: true}`.
- `POST /api/preview` - `{videoId, time, crop}` -> one cropped JPEG at
  <=480px; `time` is floored to the frame grid, the same frame the
  export will cut at.
- `POST /api/export` - `{videoId, clips, combine?}` - validates each
  clip server-side (end clamped to duration+0.5, min 0.2s). Without
  `combine`: one job per clip (`clipNo` = 1-based index). With
  `combine: true`: clips are grouped by note (trimmed, case-insensitive;
  empty note = never grouped, `groupCombine` in lib/combine.ts) and each
  group becomes ONE job carrying `clips` - a combined MP4 highlights
  export (see the recipe below); `clipNo` = index of the group's first
  clip.
- `GET /api/jobs` (newest batch first, clip order within a batch),
  `DELETE /api/jobs` (clear finished),
  `DELETE /api/jobs/[id]` - cancel one queued/running job: sets the
  cancel flag, kills the job's ffmpeg process tree, settles the job as
  `error: "cancelled by user"` and removes its `.tmp/<id>/` (returns
  `{cancelled: false}` when the job is already settled); 404 for an
  unknown id.
  `GET /api/jobs/[id]/file?k=mp4|gif|avif` (attachment download;
  content-type per extension - `video/mp4`, `image/gif`, `image/avif`;
  the filename header is the basename, so sharable outputs with a
  relative `name` download cleanly). The file is resolved under
  `out/<videoId>/` plus the dated subfolder when the id carries one.

## Frontend conventions

- `page.tsx` owns all state; components are presentational. Two
  machines are explicit reducers in lib/ (pure, unit-tested): the
  **export view** (`exportView.ts`, consumed through `useExportView`)
  and the **clip session** (`clipSession.ts`, consumed through a
  `useReducer` in page.tsx: previewed clip, back position, timeline
  focus, live range, guided flow step). The **draft model**: a single
  working `ClipSpec` that mirrors the selected committed clip
  (`updateDraft` writes to both); selecting a clip loads it into the
  draft, so every draft change edits the clip in place. The
  **in/out range is optional** (`session.hasRange`): a fresh video
  starts with none, so playback is free. A range becomes live via
  a timeline drag, I/O, the In/Out inputs, adding a clip, or selecting
  one. Playback loops the range only while one is live.
- **Add-clip flow** (guided; `step` in the clip session:
  `"idle" | "set-times" | "crop"`): "Add clip" is always enabled and
  glows (`.attn`) while no clip is selected. It creates the clip
  immediately - at the live range if there is one, otherwise a 5s
  window at the playhead - and selects it. `set-times` glows the
  Timeline with a hint chip; `crop` glows the Stage. `updateDraft`
  advances the flow: a patch touching start/end goes set-times ->
  crop, a crop patch goes crop -> idle. Esc/inert click/back,
  selecting another clip, video switch, import, and delete reset to
  idle. `.attn` is plain (unlayered) CSS in globals.css so it overrides
  the layered component border colors.
- Styling: Tailwind v4 with design tokens in `globals.css`
  (`@theme` colors + `.btn`, `.input`, `.panel`, `.chip` classes). New
  UI must reuse those tokens/classes, not redeclare colors.
- **Player size**: there is no width cap. The Stage is a flex column:
  a video *area* (16:9 at natural height; `flex-1` in fit mode, see
  the resizable work area) that holds the video box absolutely
  inset `3.333%` of the area on every side, then the scrub bar +
  transport row in a bottom band with the same horizontal margin.
  The video element is `object-contain` in the box; the crop overlay
  tracks any box size via the ResizeObserver.
- **Keyboard**: the Stage keydown listener ignores INPUT/TEXTAREA/
  SELECT so typing in the In/Out/note inputs stays native; a focused
  BUTTON passes only ArrowLeft/ArrowRight through to the seek handler
  (space/I/O/Esc keep native button behavior).
- **Range-drag pauses playback**: while an in/out handle, a range
  move, or a new-range draw is in progress, the Timeline reports it
  via its `onDragChange` prop; the page pauses playback (only if it
  was playing) and restores the playing state on release, so the frame
  under the pointer is the exact frame the clip will start on.
- **Clip list scroll cap**: the queue list is capped at 420px (~12
  rows) and scrolls internally below `xl` (`max-h-[420px]
  xl:max-h-none`); at `xl` the grid row already bounds it; rows are
  compact (`py-1`).
- The stage measures its frame with a ResizeObserver. The crop overlay
  covers the whole stage and is always active: every pointer event on
  the video crops (click = plant, drag = draw, move, 8 resize handles);
  clicking the video never toggles playback. Letterbox clicks clamp to
  the frame in `normalizeCrop`.
- **Ingest banner**: the page's mount fetch of `/api/videos` carries the
  sweep's `notice` (one line, built by `ingestNotice` in lib/ingest.ts).
  The page shows it under the video loader - `text-ok` when nothing
  failed, `text-danger` when any file was rejected - and makes a freshly
  ingested video the active one (the last one when several arrived).
- The Stage has a secondary scrub bar under the video (above the
  transport row): click/drag seeks across the full duration and shows
  the live in/out band. Stage's `inPoint`/`outPoint` props are
  nullable - the page passes `null` while no range is live.
- **Timeline interactions**: click = seek, drag on the empty track =
  draw a new in/out range (live while dragging), drag the range = move
  it, drag its edge handles = resize, right-click on the range = clear
  it (back to free playback). The selection region only renders while
  a range is live. The track shows a zoomable time window
  (`view` state in Timeline.tsx): wheel = zoom at the mouse position
  (min span 10s, max span = whole video, default = whole video),
  shift+wheel or shift+drag = scroll, double-click = fit. When zoomed,
  a range chip and a `fit` button overlay the top-right corner. While
  a range is being drawn/moved near a track edge, the view auto-pans
  (rAF loop in Timeline.tsx): the dragged content's time references
  shift with the view and the live onDraw/onMoveSel callbacks re-fire,
  so the content follows the pointer and the draft stays in sync.
- Clip batch import is client-side: `clipsTxt.ts` parses `m:ss - m:ss
  note` lines (h:mm:ss too) and `# header` sections; with several
  sections only the one whose header contains the active video's file
  name is imported (`sectionForVideo`), otherwise the UI errors instead
  of importing the wrong VOD's clips. Imported clips are clamped to the
  video duration in `page.tsx:importClips`.
- **timestamps.txt auto-save**: there is no export button for it - the
  clips PUT route (the debounced clip save) writes
  `out/<videoId>/timestamps.txt` on every save: one
  `<start> - <end> <note?>` line per clip, via `timestampsForVideo`
  (clipsTxt.ts; times through `formatClipTime`, notes flattened to one
  line). Empty list deletes the file; a failed write never fails the
  save. `clipsTxtForVideo` is the same serializer with a
  `# <video name>` header, pinned by the parse/serialize round-trip
  test - it has no UI caller.
- **Clip preview jump**: clicking a clip in the queue seeks the player to
  the clip's start and stores the pre-jump position (`session.returnTo`
  in the clip session, kept across consecutive clip clicks). The timeline also
  frames the clip with 5s of margin on each side (`focus` prop,
  `focusWindow` in times.ts) so the in/out points can be fine-tuned on
  the track; the focus is cleared on leave/switch and the view itself
  only resets via double-click/fit or a video switch. Returning is by
  clicking inert background (a document-level click listener ignores
  `closest("[data-clips-panel], [data-clip-options], [data-player],
  [data-layout], button, input, a, select, textarea")`), pressing
  `Esc` (only while the export modal is closed - the modal captures
  Esc first), or the back button in the Stage transport row. Leaving the preview also deselects the clip and clears its
  range (back to free playback). Playing, setting in/out, scrubbing,
  and switching/removing the video clear the pending return.
- Times in the clip list and the timeline in/out chip are shown with
  milliseconds (`formatTime`); the zoom-window label and the preview
  back button use `formatShort`.
- Jobs are polled every 1s; the video list is loaded once. Clips are
  per-video project files: loaded for the active video, saved with a
  500ms debounce. `clipsLoadedFor` (page.tsx state) is the single
  load gate: it keeps the clip list from showing the previous video's
  clips on a switch and keeps the save effect from writing a record
  that has not been loaded yet (the initial empty one).
- Layout: the page scrolls at every size (root `min-h-screen`, no
  fixed viewport height). At `xl` and up the work area is a
  **resizable grid** (see the next bullet): left column stacks Stage,
  Timeline, Filmstrip; right column stacks OptionsPanel over ClipQueue,
  and the grid stretches the right column to the left column's height
  so ClipQueue fills it and the clip list scrolls inside (the list
  itself is capped at 420px below `xl` - see the clip list scroll cap
  bullet above). Below `xl` everything is one column. Export progress
  is not in the layout flow at all: a front-and-center modal
  (ExportModal) with a bottom-right pill (ExportPill) as its minimized
  form; both hide themselves when no job exists.
- **Resizable work area (seams)**: at `xl` and up, draggable grips
  (the `Resizer` component, `role="separator"`, `data-layout` on the
  root) sit between the five regions: stage|timeline, timeline|
  filmstrip, left|right column, options|clipqueue. A drag sets one
  region's fixed pixel size - the page records the region's size at
  drag start (`offsetHeight`, measured; the column width comes from
  `layout.right`) and applies the total pointer delta clamped by
  `LAYOUT_LIMITS` (right 280-800, stage 140-1200, strip 72-320,
  options 96-900). Direction follows the seam: a region above/left of
  its seam (stage, options) grows with the drag, a region below/right
  of it (filmstrip, right column) shrinks with it. Double-click resets that region to its natural
  size. The sizes live in `layout` state (a `WorkLayout`:
  `right` number, `stage`/`strip`/`options` number-or-null, null =
  natural height) and feed the grid templates through CSS variables:
  outer `xl:grid-cols-[minmax(0,1fr)_auto_var(--lm-col,400px)]`, left
  `xl:grid-rows-[var(--lm-stage,auto)_auto_auto_auto_var(--lm-strip,108px)]`,
  right `xl:grid-rows-[var(--lm-opts,auto)_auto_minmax(0,1fr)]` -
  unset variables fall back to the old fixed/auto sizes. The layout
  persists to localStorage (`clipmaker.layout.v1`) on drag end and
  reset via `saveLayout`/`loadLayout` (lib/layout.ts, self-healing on
  corrupt storage). Seams are hidden below `xl`. The seam `Resizer`
  must NOT `preventDefault` on `pointerdown` - cancelling it suppresses
  the compat mouse events the double-click reset relies on; selection
  is already covered by the body `user-select: none` set during a
  drag. The inert-background click handler ignores `[data-layout]`
  (seam clicks never leave a clip preview). Resizing the stage row
  switches the Stage into `fit` mode; the Filmstrip row defaults to
  108px and its thumbnails scale with the row height; the
  OptionsPanel scrolls its form when the row is shorter than its
  natural content.
- **Export plan modal**: the ClipQueue "Export N clips" button does NOT
  start the export - it opens `ExportPlanModal` (`aria-label="Export
  clips"`): a compact centered card dialog (max-w-4xl, not full-screen)
  with a bordered header, a scrollable two-pane body, and a bordered
  footer. Left pane "clips": cards (rounded-lg, custom accent-filled
  checkbox drawn with CSS - the input stays sr-only; an unticked card
  is dimmed at opacity-50); the time + chips share one wrappable
  group (min-w-0, `wrap`) so long timestamps with all three formats
  never overflow the card. Right pane "combined highlights": ALWAYS
  visible (not only with combine on) - one card per multi-clip
  same-name group (note, part count, total duration via
  `comboDuration` + `videoFps`, mp4 chip, "one mp4 per group · 0.5s
  fade per part" hint); a group card is dimmed (opacity-50) while the
  combine toggle is off OR any of its clips is unticked, and shows
  `parts of N parts` when partial. The footer shows `N clips - M
  exports`, where M = selected count, or `groupCombine(selected).length`
  when combine is on. "Start export" (disabled at 0 selected) calls
  `startExport(selected, combine)` in page.tsx, which POSTs
  `/api/export` with the ticked clips + `combine`, then closes the plan
  and opens the export view. Like the export modal it captures
  Esc/backdrop so they do not leak to the clip preview underneath.
- **Export modal**: the view is the `exportView` reducer (modal |
  pill; with no jobs nothing renders). It opens on export and
  auto-opens on an inactive->active jobs transition (covers page
  reload mid-export). While the modal is open it is the topmost
  layer: the header button (reads `minimize` while any job is active,
  `close` once settled), `Esc`, and a backdrop click all dismiss it
  (to the pill - "N exporting" / "N failed" / "N done" plus "show" -
  whose `show` reopens it).
  The modal captures both so they do not leak to the clip preview
  underneath (capture-phase keydown with `stopPropagation`; the
  backdrop click also stops the page's inert-background click):
  while the modal is open, Esc does not leave the preview. The panel
  is a real dialog (`role=dialog`, `aria-modal`): focus moves to the
  close button on open and returns to its previous holder on close.
  The batch tri-state dot (spinner / ok / failed) in the header and in
  the pill is the shared `JobStateDot` (ExportModal.tsx). Header
  shows the overall percentage (mean over jobs); each row shows a
  status chip, the stage text, a per-job bar, and the finished outputs
  as download buttons (file name + size; the sharable tier is
  recognizable by its `-<edge>` name suffix); a `cancel` button
  (queued/running rows only)
  calls `DELETE /api/jobs/[id]` and the row then settles as
  `error: "cancelled by user"`. Footer: `clear finished` (shown only when
  settled with at least one done; clears done/error jobs and dismisses
  the view when nothing but success remains).
- **OptionsPanel sections**: clip options are grouped into titled
  sections (Note, In/Out, Formats, MP4 video, GIF / AVIF, Crop) with
  progressive disclosure - the MP4 section (frame rate, audio,
  quality) renders only when the clip's formats include mp4, and the
  the GIF / AVIF section (frame rate, sharable size cap, sharable max
  edge) only when gif/avif is selected.
- **Defaults menu**: the OptionsPanel header row (next to the
  "Clip options" label) has a `Defaults` toggle (active:
  `border-accent/60 text-accent`) that opens a `bg-panel2` section
  for the new-clip settings: format pills (at least one kept by
  `toggleDefaultsFormat`), MP4 frame rate, audio, MP4 quality
  (source/manual + kbit), and GIF/AVIF frame rate / size cap / max
  edge. Every change PUTs `/api/defaults` immediately (no debounce);
  the page fetches the object on mount. New drafts (`freshDraft` in
  page.tsx) and imported clips are created via
  `defaultClip(note, defaults)`; existing clips keep their own
  settings, and "Add clip" with a clip selected still copies that
  clip's draft (the draft model is unchanged).
- **AVIF duration warning**: AV1 encodes are slow, so a clip whose
  formats include avif warns by length - yellow (`text-warn`) above 45s,
  red (`text-danger`) above 60s. The OptionsPanel shows it in the
  GIF/AVIF section; ClipQueue rows show a matching `slow` chip. The
  level comes from `avifDurationLevel` (lib/avif.ts, pure, unit-tested).

## Gotchas
- **typescript is pinned to ^5.9** - TS 7 breaks Next 15's config
  transpile. Do not bump it.
- **Ingest "still writing" has two triggers**: a size change during the
  probe, or the rename failing with EBUSY/EPERM/EACCES (`classifyMoveFailure`)
  because the writer still owns the file. The size check alone misses
  write stalls (e.g. between the writer's flushes), so the errno class is
  the backstop - both report the file as pending, not rejected.
- **`CLIPMAKER_INGEST_DIR` may point at another volume** (a mount): the
  sweep falls back to copy+unlink when rename hits EXDEV.
- **The ingest sweep runs inside `GET /api/videos`** - a page load is the
  ingest trigger by contract. Drops after a load wait for the next
  navigation/refresh; the sweep is single-flight, so concurrent loads
  share one run.
- ffmpeg/ffprobe discovery order: `CLIPMAKER_FFMPEG`/`CLIPMAKER_FFPROBE`
  env vars > PATH > `C:\ProgramData\chocolatey\bin`. The probe is
  spawnSync `-version`, cached in-process; `findBin` must keep working
  when the binary is absent (routes return a clean error, no crash).
- A server restart marks running/queued jobs as errored ("server
  restarted before the job finished") - temp files in `.tmp/` of a dead
  job are orphaned and can be removed. On the same load, legacy
  jobs.json rows with a string `stage` migrate to null.
- The MP4 stage encodes directly into `out/<videoId>/` (not a temp
  file), so a job that is cancelled or errors mid-MP4-encode leaves a
  partial `.mp4` behind in `out/` (it is not in the job's `outputs`).
  GIF/AVIF stages only write to `out/` after the whole tier succeeds,
  so they are clean. Cancelling mid-GIF/AVIF never leaves partial
  sharable files.
- Uploads stream straight from `req.body` (Web stream reader) into the
  destination file with `once(ws, "drain")` backpressure - do not buffer
  the body in memory.
- On Windows, never create `nul` files (reserved name); redirect command
  output to real temp files.
- The dev server runs natively on :10100 (not Docker) because it needs
  local video paths and the local NVENC GPU. Long-lived processes must
  be killed by PID, never by image name. The optimized version is
  `bun run prod` (`next build` then `next start`, same :10100 port).

## Verification

- `bun test` - 229 unit tests over the pure libs (times, bitrate,
  avif, ladder, names, vodDate, crop, combine, args, clipsTxt, clips,
  types, jobs, stages, exportView, clipSession, layout, filmstrip,
  ingest, ffmpeg's once).
- `bunx tsc --noEmit` - typecheck.
- End-to-end: load a video by path, mark in/out, draw a crop, export;
  check the job output with ffprobe (duration within 1.5 frames of the
  requested range, expected fps, audio stream when expected, full-tier
  gif/avif at source resolution uncapped, sharable tier's longest edge at
  maxEdge (or the crop's longest edge when smaller) within the size cap,
  avif codec `av1`) and confirm
  `GET /api/videos/<id>/file` answers 206 for a Range request.
- Ingest: drop a file into `ingest/` and refresh - it is moved into
  `uploads/<videoId>/`, registered (banner + auto-selected); a file
  still being written reports pending and ingests on the next refresh;
  an unproberable file lands in `ingest/failed/` with a `.err` sidecar.
