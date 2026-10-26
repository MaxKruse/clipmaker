# AGENTS.md - clipmaker

Technical documentation for agents working on this codebase. User-facing
docs live in README.md; keep the two in sync when behavior changes.

## What it is

A local web app that cuts clips from local videos and exports them as MP4
and/or GIF. Next.js 15 App Router, React 19, TypeScript, Tailwind v4
(hand-rolled UI components, no component library). All ffmpeg work runs
server-side via `child_process`; the browser only handles UI, preview
frames, and download links.

## Architecture

The code is layered so that everything testable is pure:

```
src/lib/times.ts    time parsing/formatting + clip focus window
src/lib/bitrate.ts  source-kbit detection + fps-scaled target kbit
src/lib/ladder.ts   GIF shrink ladder (resolution/runge + fps steps)
src/lib/names.ts    safe output file names (clip1-note.mp4, ...)
src/lib/crop.ts     CropBox model, normalizeCrop (even, clamped, >=16px)
src/lib/clipsTxt.ts parse Clips .txt notes (time ranges + # sections)
src/lib/args.ts     ffmpeg argument builders (mp4/gif stages/preview)
src/lib/types.ts    VideoInfo, ClipSpec, Job, ProbeResult + defaults
src/lib/human.ts    human sizes ("4.7 MB")
      -- everything above is pure and unit-tested (test/*.test.ts) --
src/lib/ffmpeg.ts   ffmpeg/ffprobe discovery + spawn wrappers, progress
src/lib/store.ts    disk-backed session store (.data/) + dir constants
src/lib/runner.ts   bounded export job pool (CLIPMAKER_CONCURRENCY, default 2; the only ffmpeg caller)
src/app/api/**      thin route handlers over store/runner
src/components/**   UI, all "use client"
src/app/page.tsx    page state owner (videos, clips, draft, jobs polling)
```

Key invariants:

- **`args.ts` builders are locked by their unit tests.** Changing the
  order or content of the generated ffmpeg arguments without updating
  `test/args.test.ts` breaks the suite. The tests pin the exact recipes.
- **The runner is the only place that spawns ffmpeg.** Routes and
  components never build ffmpeg commands themselves.
- **Crops are stored in source pixels** (`CropBox {x,y,w,h}`, all even,
  min 16px, clamped to the frame). The UI converts between screen px and
  source px via the measured frame rect; the preview route re-normalizes
  server-side, so a stale UI crop can never produce an invalid filter.
- **Progress events use `-progress pipe:1`**; both `run` and
  `runProgress` in ffmpeg.ts parse it. `runProgress` takes the expected
  total duration and reports 0..100.

## Data model

- `VideoInfo { id, name, path, uploaded, size, duration, width, height,
  fps, hasAudio, videoKbit, formatKbit }` - probed once at load.
  `uploaded` marks files copied into `uploads/` (safe to delete).
- `ClipSpec { id, note, start, end, crop, formats, audio, fps, quality,
  gif }` - one clip. `quality { mode: "source" | "manual", kbit }`;
  `gif { maxMB, maxEdge }`. Defaults in `types.ts:defaultClip()`.
- `Job { id, videoId, videoName, clip, clipNo, status, progress, stage,
  outputs, error, warning, createdAt }` - `status` is queued/running/
  done/error. `outputs` is an array of `{ kind: "mp4" | "gif", name, size }`
  for files under `out/<videoId>/`.

## Disk layout (all gitignored, created lazily)

- `.data/videos.json`, `.data/jobs.json` - persisted session state.
- `uploads/<videoId>/<name>` - uploaded files.
- `out/<videoId>/clipN[-note].mp4|gif` - finished exports.
- `.tmp/<jobId>/` - per-job temp files, deleted in a `finally`.

## Export recipes (ported from the clipmaker skill)

- **MP4**: input seek `-ss <start>`, output cut `-t <dur>`, always
  re-encode. Video: nvenc (fullres VBR) when available, else libx264
  slow. Bitrate: source-matched by default
  (`targetVideoKbit(sourceKbit, srcFps, outFps)`), manual kbit allowed.
  Audio: AAC 192k with `asetpts,apad` when the source has audio and the
  clip keeps audio. After encoding, container+video durations are
  verified within 1.5 frames; one retry; a second miss becomes a
  `job.warning` (the file is kept).
- **GIF** (never gif-from-VOD): stage 1 cuts an intermediate mp4 at
  `<maxEdge>`p30; stage 2 `palettegen` (256 colors, `stats_mode=full`);
  stage 3 encodes down the ladder (scale 1.0@30, 1.0@25, .75, .625, .5,
  .375, .25@25) taking the first rung whose file is <= maxMB; an
  emergency 0.1875@25 rung is tried last; if it still exceeds the cap
  the job fails.
- **Encoder choice** is probed once (`nvencAvailable()`, a 320x180
  testsrc probe-encode, cached in-process).

## API

- `POST /api/videos` - JSON `{path}` registers a local file (probed,
  referenced in place); a raw body (no multipart) with an `x-filename`
  header uploads it into `uploads/`. 64GB cap, backpressure handled.
- `GET /api/videos`, `DELETE /api/videos/[id]` - list / remove (deletes
  the upload dir only when `uploaded`).
- `GET /api/videos/[id]/file` - byte-range streaming (206); the `<video>`
  element needs this for seeking.
- `GET/PUT /api/videos/[id]/clips` - the video's project file: fetch
  the persisted clip list, or replace it (every clip validated through
  `toClip` in `lib/clips.ts`, max 500 clips). 404 for unknown videos.
- `POST /api/preview` - `{videoId, time, crop}` -> one cropped JPEG at
  <=480px.
- `POST /api/export` - `{videoId, clips}` - validates each clip server-
  side (end clamped to duration+0.5, min 0.2s), enqueues one job per
  clip (`clipNo` = 1-based index).
- `GET /api/jobs` (newest first), `DELETE /api/jobs` (clear finished),
  `GET /api/jobs/[id]/file?k=mp4|gif` (attachment download).

## Frontend conventions

- `page.tsx` owns all state; components are presentational. The
  **draft model**: a single working `ClipSpec` that mirrors the selected
  committed clip (`updateDraft` writes to both); selecting a clip loads
  it into the draft, so every draft change edits the clip in place.
  The **in/out range is optional** (`hasRange` in page.tsx): a fresh
  video starts with none, so playback is free. A range becomes live via
  a timeline drag, I/O, the In/Out inputs, adding a clip, or selecting
  one. Playback loops the range only while one is live.
- **Add-clip flow** (guided; `step` state in page.tsx: 0 idle, 1 set
  times, 2 crop): "Add clip" is always enabled and glows (`.attn`)
  while no clip is selected. It creates the clip immediately - at the
  live range if there is one, otherwise a 5s window at the playhead -
  and selects it. Step 1 glows the Timeline with a hint chip; step 2
  glows the Stage. `updateDraft` advances the flow: a patch touching
  start/end goes 1 -> 2, a crop patch goes 2 -> 0. Esc/inert click/back,
  selecting another clip, video switch, import, and delete reset to 0.
  `.attn` is plain (unlayered) CSS in globals.css so it overrides the
  layered component border colors.
- Styling: Tailwind v4 with design tokens in `globals.css`
  (`@theme` colors + `.btn`, `.input`, `.panel`, `.chip` classes). New
  UI must reuse those tokens/classes, not redeclare colors.
- The stage measures its frame with a ResizeObserver. The crop overlay
  covers the whole stage and is always active: every pointer event on
  the video crops (click = plant, drag = draw, move, 8 resize handles);
  clicking the video never toggles playback. Letterbox clicks clamp to
  the frame in `normalizeCrop`.
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
- **Clip preview jump**: clicking a clip in the queue seeks the player to
  the clip's start and stores the pre-jump position (`returnTo` in
  page.tsx, kept across consecutive clip clicks). The timeline also
  frames the clip with 5s of margin on each side (`focus` prop,
  `focusWindow` in times.ts) so the in/out points can be fine-tuned on
  the track; the focus is cleared on leave/switch and the view itself
  only resets via double-click/fit or a video switch. Returning is by
  clicking inert background (a document-level click listener ignores
  `closest("[data-clips-panel], [data-clip-options], [data-player],
  textarea)"), pressing `Esc`, or the back button in the Stage transport
  row. Leaving the preview also deselects the clip and clears its
  range (back to free playback). Playing, setting in/out, scrubbing,
  and switching/removing the video clear the pending return.
- Jobs are polled every 1s; the video list is loaded once. Clips are
  per-video project files: loaded for the active video, saved with a
  500ms debounce, gated on the `clipsReady` ref (the active video's
  load finished) so the initial empty record never clobbers disk.
- Layout: at `xl` and up the app fits the viewport (root `h-screen`, no
  page scroll): the Stage video box stretches to fill the left column,
  the clip list scrolls inside ClipQueue, and the exports panel is capped
  at 40% of the sidebar with its own scroll. Below `xl` it falls back to
  page scroll and a 16:9 video box.

## Gotchas
- **typescript is pinned to ^5.9** - TS 7 breaks Next 15's config
  transpile. Do not bump it.
- ffmpeg/ffprobe discovery order: `CLIPMAKER_FFMPEG`/`CLIPMAKER_FFPROBE`
  env vars > PATH > `C:\ProgramData\chocolatey\bin`. The probe is
  spawnSync `-version`, cached in-process; `findBin` must keep working
  when the binary is absent (routes return a clean error, no crash).
- A server restart marks running/queued jobs as errored ("server
  restarted before the job finished") - temp files in `.tmp/` of a dead
  job are orphaned and can be removed.
- Uploads stream straight from `req.body` (Web stream reader) into the
  destination file with `once(ws, "drain")` backpressure - do not buffer
  the body in memory.
- On Windows, never create `nul` files (reserved name); redirect command
  output to real temp files.
- The dev server runs natively on :10100 (not Docker) because it needs
  local video paths and the local NVENC GPU. Long-lived processes must
  be killed by PID, never by image name.

## Verification

- `bun test` - 76 unit tests over the pure libs (times, bitrate,
  ladder, names, crop, args, clipsTxt, clips).
- `bunx tsc --noEmit` - typecheck.
- End-to-end: load a video by path, mark in/out, draw a crop, export;
  check the job output with ffprobe (duration within 1.5 frames of the
  requested range, expected fps, audio stream when expected, gif within
  the size cap) and confirm `GET /api/videos/<id>/file` answers 206 for
  a Range request.
