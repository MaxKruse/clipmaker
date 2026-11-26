# AGENTS.md - clipmaker

Technical documentation for agents working on this codebase. User-facing
docs live in README.md; keep the two in sync when behavior changes.

**UI changes require a README screenshot reshoot.** The README's "At a
glance" section shows the use-case flow with the example cat video
(`docs/screenshot-1-add.png` ... `docs/screenshot-4-main.png`). When a
change alters the rendered interface (layout, components, labels,
colors), reshoot all four screenshots with the same cat video and
replace the PNGs, so the examples keep matching the live UI.

**The example video lives in `docs/example/cat-lapping.webm`**
(gitignored, 1280x720, 23.7s, ~10.4 MB) and is ALWAYS reused for
reshoots - register it by path (`POST /api/videos`), remove it
(`DELETE /api/videos/<id>`) when done. Never store scratch copies in
`.tmp/`: the store's `sweepTmp` wipes everything under it on every
server init (an HMR module reload counts). If the file is missing,
restore it with:
`curl -sL -A "clipmaker-docs/1.0" -o docs/example/cat-lapping.webm "https://web.archive.org/web/20181001004442id_/https://upload.wikimedia.org/wikipedia/commons/a/ac/Cat_lapping_water_off_ground_in_slow_motion.gk.webm"`

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
src/lib/bitrate.ts  source-kbit detection + fps-scaled target kbit + resolveOutKbit (manual vs source)
src/lib/ladder.ts   GIF ping-pong shrink ladder (edge x fps rungs, deduped) + AVIF 3-axis ladder + sharableCap (maxEdge vs the full tier's longest edge, and the scale axis)
src/lib/names.ts    safe output file names (clip1-note.mp4, highlightsFileName for
                    combined <note>-highlights.mp4) + RFC 6266 disposition for
                    downloads
src/lib/vodDate.ts  broadcast date in a VOD file name -> dated video id
                    (<date>_<random> via newVideoId) + dateFromVideoId (id -> date)
src/lib/crop.ts     CropBox model (x,y,w,h + rotation angle), clampAngle,
                    cropCenter, cropBBox (tilted crop's axis-aligned bbox),
                    normalizeCrop (even, clamped, >=16px; tilted crop's bbox
                    re-centered/shrunk to fit the frame), cropFilter (the
                    straighten recipe: bbox crop + rotate + center crop)
src/lib/clipsTxt.ts parse Clips .txt notes (time ranges + # sections) + the
                    inverse timestampsForVideo serializer (round trip pinned
                    by test/clipsTxt.test.ts)
src/lib/clips.ts    client-side sanitizers: toClip (untrusted clip -> ClipSpec) and
                    toDefaults (untrusted defaults -> ClipDefaults, field-wise
                    fallback to the shipped defaults)
src/lib/combine.ts  same-name grouping (groupCombine), combo math (duration,
                    0.5s fades, target size) for the MP4 highlights combine,
                    plus the sharable-tier ladder (comboShareRungs: the
                    full tier's own longest edge first, then the fixed
                    1080/768/512/256, even-floored; COMBO_SHARE_FPS/CRF/
                    MAX_MB) and the middle-section
                    rule (comboShareSections: ~180s of content total, 8-15s
                    per part by part count, a shorter part gives its whole
                    length)
src/lib/args.ts     ffmpeg argument builders (mp4/gif/avif stages/preview,
                    combo cut, combo share-section middle cut, combo
                    sharable re-encode, concat)
src/lib/jobs.ts     export list display order (newest batch first, clip order within)
src/lib/jobFiles.ts exportDir/outputPath (the ONE home of the dated export-dir
                    path rule) + saveTimestampsMirror (timestamps.txt writer) +
                    outputsGone (done job whose output files are deleted) +
                    safeOutputName (only a bare name, sharable/ or
                    highlights/ may reach the out dir - loadJobs drops
                    rows carrying anything else) - server-only (node:); the
                    client imports jobs.ts
src/lib/stages.ts   structured export job stages (JobStage) + user-facing stage text
src/lib/exportView.ts export view state machine (modal | pill)
src/lib/clipSession.ts clip session state machine (preview, back position, focus, range, flow step)
src/lib/layout.ts     resizable work-area layout (WorkLayout, LAYOUT_LIMITS, clamp, load/save with injected IO)
src/lib/avif.ts       avifDurationLevel (length-based AVIF encode warning, 45s/60s) +
                    avifWarningText (the shared user-facing warning sentence)
src/lib/range.ts    HTTP byte-range parsing (parseRangeHeader: 206 ranges,
                    suffix ranges, 416 rules)
src/lib/types.ts    VideoInfo, ClipSpec, ClipDefaults, Job, MIN_CLIP_SECONDS +
                    defaultClip(note, defaults) / defaultClipDefaults() /
                    toggleFormatIn (formats list, keeps at least one) /
                    defaultsSummary (live one-line defaults text)
src/lib/human.ts    human sizes ("4.7 MB")
src/lib/dialogStack.ts last-opened-dialog-wins Esc stack (push/pop/isTop)
      -- everything above is pure and unit-tested (test/*.test.ts) --
src/lib/filmstrip.ts filmstrip sampling plan (pure) + server-only single-flight
                    thumbs/ generation pool + removeThumbsForVideo (DELETE route)
                    + removeOrphanedThumbs (sweeps caches of self-healed videos)
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
src/lib/store.ts    disk-backed session store (.data/) + dir constants;
                    self-heals stale rows on load (rewrites the JSON files)
src/lib/runner.ts   bounded export job pool (CLIPMAKER_CONCURRENCY, default 2; the only ffmpeg caller) + cancelJob (the only way to interrupt a queued/running job); runCombined is the combined-MP4 pipeline for jobs with job.clips; a DONE job re-establishes the video's timestamps.txt mirror (saveTimestampsMirror, best-effort)
src/app/api/**      thin route handlers over store/runner (GET /api/videos
                    also sweeps orphaned filmstrip caches)
src/components/**   UI, all "use client"; useExportView.ts is the thin hook
                    around the exportView reducer; Dialog.tsx is the
                    shared modal chrome (backdrop, stacked Esc, focus);
                    SettingsModal.tsx is the settings page for the
                    new-clip defaults
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
- **Crops are stored in source pixels** (`CropBox {x,y,w,h,angle}`, x/y/w/h
  even, min 16px, clamped to the frame). `x,y` are the axis-aligned base
  box; `angle` (degrees, 0 = axis-aligned, positive = clockwise, clamped
  to +/-45) is the crop's rotation about its center. The UI converts between
  screen px and source px via the measured frame rect and a `toLocal`
  (pointer rotated into the crop's own frame); the preview route re-normalizes
  server-side, so a stale UI crop can never produce an invalid filter.
- **A tilted crop is straightened on export, not exported tilted.** The
  output is the crop's content at 0 degrees, sized `w x h`, with no black
  corners: ffmpeg crops the crop's axis-aligned bounding box, `rotate`s it
  about the crop center (the bbox center) by `-angle`, then crops the centered
  `w x h`. At `angle=0` this is byte-identical to the plain `crop=w:h:x:y`,
  so existing clips are untouched. `normalizeCrop` re-centers/shrinks a tilted
  crop so its bounding box stays inside the frame.
- **Progress events use `-progress pipe:1`**; both `run` and
  `runProgress` in ffmpeg.ts parse it. `runProgress` takes the expected
  total duration and reports 0..100. It reads ONLY `out_time_us`:
  ffmpeg's `out_time_ms` field is ALSO microseconds (long-standing
  ffmpeg quirk) - parsing it as ms pins the bar at the 0.99 clamp for
  the whole stage. Every encode builder must carry `-progress pipe:1`,
  so each stage reports its own progress.
- **The export-dir path rule has exactly one home**: `exportDir` /
  `outputPath` (jobFiles.ts) - dated ids get a subfolder of just that
  date under the video folder. The runner, the download route, and
  `outputsGone` all resolve through it. `timestamps.txt` is NOT in that
  folder: it always sits at the video root, and is rewritten by the
  clips PUT route on every save AND by the runner after every done job
  (`saveTimestampsMirror`, best-effort) - so deleting the export folder
  (or just the file) and re-exporting brings the mirror back.
- **Duration checks share one tolerance**: `DURATION_TOLERANCE_FRAMES`
  (1.5 frames of the OUTPUT fps) in runner.ts, used by the full-tier
  check (miss = one retry) and the sharable check (miss = warning).
- **Job stages are structured, not free strings.** The runner builds
  `JobStage` objects (stages.ts); the export modal renders them through
  `stageText`, whose wording is pinned by `test/stages.test.ts`.
  jobs.json rows with a legacy string stage migrate to null on load
  (store.ts:loadJobs).

## Data model

- `VideoInfo { id, name, path, uploaded, sizeBytes, duration, width,
  height, fps, hasAudio, videoKbit, audioKbit, formatKbit }` - probed
  once at load.
  `uploaded` marks files copied into `uploads/` (safe to delete).
  `id` is generated by `newVideoId(basename)` (lib/vodDate.ts):
  `<date>_<random>` when the source file name carries a broadcast date
  (`YYYY-MM-DD`, e.g. Twitch/Kick downloader names, or a full 8-digit
  `YYYYMMDD` run), plain `<random>` otherwise. The date comes back out
  of the id via `dateFromVideoId`; videos registered before that stay
  on their legacy random id and flat layout.
- `ClipSpec { id, note, start, end, crop, formats, audio, fps, quality,
  anim }` - one clip. `crop` is `CropBox | null` = `{x,y,w,h,angle}` (see
  the crop invariant: `angle` is the tilt about the crop center, straightened
  on export). `formats` is a non-empty subset of
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
  highlights file, `clip` = the group's first member (with
  `formats` forced to `["mp4"]` for display). `clipNo` is the 1-based
  position of that first member in the video's clip list (the group's
  queue position), not a job index.
  `status` is
  queued/running/
  done/error. `stage` is the structured `JobStage` (stages.ts) while
  running, null when settled; the modal renders it via `stageText`.
  `outputs` is an array of `{ kind: "mp4" | "gif" | "avif",
  name, size, tier?: "full" | "sharable" }` for files under the video's
  `out/<videoId>/`, plus the `<date>` subfolder for dated
  `name` may be a relative path like `sharable/clip1-note.gif` or
  `highlights/<note>-highlights.mp4`; `tier` is absent on old jobs).
  Combined jobs push the full highlights file in its own highlights/
  folder (`highlights/<note>-highlights.mp4`, `tier: "full"`) and, when
  the sharable ladder fits, `sharable/<note>-highlights.mp4`
  (`tier: "sharable"`) - the middle-sections file, ONE entry no matter
  how long the full tier is.
- `Job.stage` is null when the job settles, including on error.

## Disk layout (all gitignored, created lazily)

- `.data/videos.json`, `.data/jobs.json` - persisted session state.
- `.data/defaults.json` - new-clip defaults (`ClipDefaults`); created
  on first save, loaded through `toDefaults` so a corrupt file
  self-heals to the shipped defaults.
- `uploads/<videoId>/<name>` - uploaded files.
- `ingest/` - drop folder for huge files. Not created by the app (the
  user creates it, optionally at another location via
  `CLIPMAKER_INGEST_DIR`). The next page load moves proberable files
  into `uploads/<videoId>/` and registers them; files that fail the probe
  are left in place and retried on the next page load, and only after
  three consecutive failed sweeps are they quarantined into
  `ingest/failed/` with a `.err` sidecar (an in-process counter, so a
  genuinely corrupt file always reaches `failed/` while a mid-write file
  keeps its chance); files still being written (size change during the
  probe, or the writer still locking them) are left in place and retried
  on the next page load.
- `out/<videoId>/...` - per-video export dir. Dated videos (see
  VideoInfo) put every export file in a subfolder of just that date:
  `out/<videoId>/<date>/clipN[-note].mp4|gif|avif` (full tier) and
  `out/<videoId>/<date>/sharable/` (sharable copies); undated and
  legacy videos keep the flat layout directly in `out/<videoId>/`.
  `timestamps.txt` (clips mirror) always sits at the video root,
  rewritten on every clip save and after every done export job of the
  video.
- `thumbs/<videoId>/` - filmstrip JPEG frame cache, regenerated on
  demand, deleted with the video (DELETE route) or swept as an orphan
  on the next page load (GET /api/videos -> removeOrphanedThumbs).
- `docs/example/cat-lapping.webm` - the README screenshot example
  video (see the reshoot rules at the top); restore from the Wayback
  URL if missing.
- `.tmp/<jobId>/` - per-job temp files, deleted in a `finally`.

## Export recipes (summary)

Full narrative in **docs/export-recipes.md**; exact arguments pinned by
`test/args.test.ts` and commented in `args.ts`. The crop filter
(`cropFilter` in lib/crop.ts) is the first `-vf` stage of every encode that
carries a crop: axis-aligned it is `crop=w:h:x:y`; tilted it straightens the
crop (bbox crop + `rotate=-angle` about the crop center + centered `w x h`
crop), so a tilted crop exports as a level `w x h` with no black corners.

- **MP4**: frame-floored cut, always re-encoded; nvenc (fullres VBR)
  when available else libx264 slow; source-matched or manual kbit;
  AAC 192k + `asetpts,apad` with audio. Duration verified within
  1.5 frames, one retry, second miss = warning (file kept).
- **GIF / AVIF**: one shared full-res intermediate mp4 (clip frame,
  crop, `anim.fps`) feeds every tier. ALWAYS two versions per format:
  a **full** tier (full resolution, uncapped, export dir root) and a
  **sharable** tier (longest edge at `anim.maxEdge` via `sharableCap`,
  capped at `anim.maxMB`, in `sharable/`; the gif carries the winning
  rung's `-<edge>` name suffix). GIF: shared palette + ping-pong edge
  x fps ladder (`buildLadder`, deduped), emergency rung last, cap miss
  = failed job. AVIF: crf30 full tier; 3-axis ladder (CRF 25/29/33/36
  outer, same fps/edge grid inner, 48 rungs), emergency
  maxEdge@anim.fps@crf40 last, cap miss = failed job.
- **Combined MP4 (highlights)**: MP4 only, ONE mp4 file per same-name
  group, IN ADDITION to the parts' individual exports. Per-part
  frame-accurate segments (target = largest clip's size, 0.5s fades,
  uniform audio: source / silent / none) concat-demuxed into the final
  mp4 with the normal encoder, `highlights/<note>-highlights.mp4`
  (never a `clipN-` name). Sharable tier (an addition): each part's
  MIDDLE section (~180s total, 8-15s per part) re-cut at fixed 30fps
  with its own fades, concat-demuxed straight through the
  longest-edge rung ladder (full tier's edge first, then
  1080/768/512/256) at x264 crf20 / nvenc constqp cq20, 96k aac, first
  file under 48MB wins: `sharable/<note>-highlights.mp4`. Runs AFTER
  the full tier, so a cap miss is a warning, not a failure.
- **Encoder choice** is probed once per kind and cached in-process:
  `nvencAvailable()` and `avifEncoder()` (libsvtav1 preferred,
  libaom-av1 fallback; null = AVIF jobs fail cleanly, MP4/GIF
  unaffected).

## API

Full reference in **docs/api.md**. Sharp rules only:

- `GET /api/videos` is the ONLY ingest trigger (page load) and also
  sweeps orphaned filmstrip caches - the sweep is single-flight.
- `DELETE /api/videos/[id]` cancels the video's active exports FIRST,
  then drops the row, the jobs, and the runtime dirs (`out/<id>/`,
  `thumbs/<id>/`, the upload dir when `uploaded`).
- `PUT /api/videos/[id]/clips` validates every clip through `toClip`
  (max 500) and mirrors the list to `timestamps.txt` best-effort; GET
  re-sanitizes stored rows, so legacy shapes self-migrate on read.
- `POST /api/export`: every ticked clip gets its OWN job; `combine`
  note keys ADD one combined job per 2+ part group; `nos` (1-based
  queue positions from the client) fall back to the subset index; one
  `createdAt` stamp per request.
- `DELETE /api/jobs/[id]` is the only cancel path (kills the ffmpeg
  process tree); `GET /api/jobs/[id]/file?k=..&t=..` resolves through
  `outputPath`, so a dated id serves from the date subfolder.

## Frontend conventions (sharp rules)

The full per-component tour lives in **docs/ui-conventions.md** - read
it before touching the page state or a component. The rules that must
not be lost, short:

- `page.tsx` owns all state; components are presentational. Two
  explicit machines (pure, unit-tested lib/ reducers): the **export
  view** (`exportView.ts` via `useExportView`) and the **clip
  session** (`clipSession.ts` via `useReducer`: previewed clip, back
  position, timeline focus, live range, guided flow step). The **draft
  model**: one working `ClipSpec` mirroring the selected committed
  clip - `updateDraft` writes to both. The in/out range is OPTIONAL
  (`session.hasRange`): a fresh video has none, so playback is free.
- **Add-clip flow**: "Add clip" (glowing `.attn` while nothing is
  selected) creates the clip immediately (live range, else 5s window at
  the playhead) and selects it; `set-times` glows the Timeline, `crop`
  glows the Stage; touching the times finishes set-times, setting a
  crop finishes crop; Esc/inert-click/back, another selection, video
  switch, import, delete reset to idle. `.attn` is plain (unlayered)
  CSS in globals.css so it overrides the layered component borders.
- **Crop rotation**: `CropOverlay` draws the crop as a div rotated about its
  center (`transform: rotate(angle)`, `transformOrigin: center`); all
  hit-testing converts the pointer with `toLocal` (rotated into the crop's
  own frame, where it reads axis-aligned). A `rot` handle sits just outside
  the NE corner - grabbing it turns the crop about its center (the new angle
  is the handle's pointer angle minus its rest angle, relative to the
  center). draw/move/rot read the source frame; the resize handles read the
  local frame. A fresh draw is axis-aligned; a move/resize keeps the tilt.
  The crop section of `OptionsPanel` shows the angle in the chip and a
  "straighten" button (sets `angle` to 0) when tilted.
- Styling: Tailwind v4 design tokens in `globals.css` (`@theme` colors
  + `.btn`/`.input`/`.panel`/`.chip`). New UI reuses tokens/classes,
  never redeclares colors.
- **Keyboard**: the Stage keydown listener ignores INPUT/TEXTAREA/
  SELECT (typing stays native); a focused BUTTON passes only
  ArrowLeft/ArrowRight through (space/I/O/Esc keep native behavior);
  callbacks reach the listener via a `cbRef` so the subscription never
  re-subscribes.
- **Range-drag pauses playback** (Timeline `onDragChange` -> page
  suspends/restores), so the frame under the pointer is the exact
  frame the clip will start on.
- **Inert-background click** leaves the clip preview; the listener
  ignores `closest("[data-clips-panel], [data-clip-options],
  [data-player], [data-layout], button, input, a, select, textarea")` -
  new click-ignorable regions must be added to that list.
- **Timeline**: click = seek, track drag = draw range, range drag =
  move, edge handles = resize, right-click range = clear. Zoomable
  window (min span 10s, default = whole video), shift+wheel/drag =
  pan, double-click = fit, auto-pan while dragging near a track edge.
- **Clip preview jump**: selecting a clip seeks to its start, stores
  the pre-jump position (`session.returnTo`), and frames the clip in
  the timeline (5s margin, `focusWindow`); returning restores the
  position, deselects, and clears the range.
- **Clips are per-video project files**: loaded for the active video
  (gated by `clipsLoadedFor`), saved with a 500ms debounce; a pending
  save for video A must LAND before a reload of A (the load effect
  awaits `flushPendingSave()` for the same id), or the reload adopts
  the pre-edit list and re-saves it over the edit. Jobs are polled
  every 1s.
- **timestamps.txt** has no button: the clips PUT route writes it on
  every save, the runner re-writes it after every done job (deleting
  the export folder and re-exporting brings it back).
- Layout: below `xl` the page scrolls; at `xl`+ the app is
  viewport-fitted with a **resizable work area** (`Resizer` seams,
  `LAYOUT_LIMITS`, persisted to localStorage via `lib/layout.ts`).
  Sharp rules: the seam `Resizer` must NOT `preventDefault` on
  `pointerdown` (the double-click reset needs the compat mouse events);
  both column divs carry `min-h-0` (without it the queue's min-content
  height pushes the work area off-screen); the root must NOT clip
  (`overflow-hidden` would cut off pinned panels).
- **Shared dialog chrome** (`Dialog.tsx`): backdrop click, stacked Esc
  (topmost dialog wins, `dialogStack.ts`), focus-in/restore. All four
  modals (export, videos, export plan, settings) render through it.
- **Export plan modal** opens on "Export N clips" (NOT a direct
  export): clip cards with checkboxes + one checkbox per multi-clip
  same-name group; a ticked group ADDS one mp4 highlights file of its
  2+ SELECTED parts on top of the parts' own exports; footer shows
  `N clips - M exports`.
- **Export modal / pill**: the `exportView` machine (modal | pill;
  nothing renders with no jobs); rising-edge auto-open; while open it
  is the topmost layer (Esc/backdrop captured so they don't leak to
  the clip preview); per-job cancel settles `error: "cancelled by
  user"`; "clear finished" only when settled with at least one done.
- **OptionsPanel** sections use progressive disclosure (MP4 section
  only when mp4 is selected; GIF/AVIF section only when gif/avif is
  selected). **Settings modal** edits the persisted new-clip defaults
  (every change PUTs immediately). **AVIF duration warning**: yellow
  >45s, red >60s (`avifDurationLevel`), shown in the panel and as a
  `slow` chip in the queue.

## Gotchas
- **`jobs.ts` is imported by client components** (page, ExportModal,
  ExportPill) and must never gain a runtime `node:` import - `next build`
  fails with `UnhandledSchemeError` (dev mode does not catch it).
  Server-only job helpers live in `jobFiles.ts` (which also may not be
  imported by client code).
- **typescript is pinned to ^5.9** - TS 7 breaks Next 15's config
  transpile. Do not bump it.
- **Ingest "still writing" has two triggers**: a size change during the
  probe, or the rename failing with EBUSY/EPERM/EACCES (`classifyMoveFailure`)
  because the writer still owns the file. The size check alone misses
  write stalls (e.g. between the writer's flushes), so the errno class
  is the backstop - both report the file as pending, not rejected.
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
- **The store self-heals stale rows on load, and rewrites the JSON
  files when it drops or migrates anything.** On load: video sessions
  whose source file is gone are dropped, done jobs whose output files
  were deleted by hand (`outputsGone` in lib/jobFiles.ts) are dropped, jobs
  whose video no longer exists are dropped, running/queued jobs become
  errored ("server restarted before the job finished"), and clip lists
  for videos that no longer exist are dropped (the orphan case a UI
  video deletion used to leave behind). Each of the three `.data` JSON
  files is rewritten whenever a row is dropped/migrated, so the disk
  matches the in-memory sessions. `store.updateJob` no-ops for a job
  whose video is gone: a running export killed by the video's removal
  settles asynchronously after `removeVideo`, and must not resurrect
  the row. Temp files in `.tmp/` of a dead job are orphaned and can be
  removed; legacy jobs.json rows with a string `stage` migrate to null.
- **Self-heal never deletes `out/<videoId>/`.** A dropped session's
  export files are FINISHED EXPORTS (user data, potentially GBs): only
  the user's own DELETE (the UI confirm) removes them. The filmstrip
  cache IS pure cache, so `GET /api/videos` sweeps orphaned
  `thumbs/<videoId>/` dirs via `removeOrphanedThumbs` after the
  self-heal. Do not "help" by deleting out/ on self-heal.
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
- **In dev mode, each API route's first lazy compile re-initializes the
  store and runner modules** (one module registry per route - verified
  with a module-scope init marker): an export enqueued via `/api/export`
  runs to completion and writes its files, but `/api/jobs` serves its
  own registry's store, which healed the still-running jobs as "server
  restarted before the job finished" at its own init. Export e2e
  verification must run against `bun run prod` (one server bundle, one
  store), where jobs poll live.

## Verification

- `bun test` - 295 unit tests over the pure libs (times, bitrate,
  avif, ladder, names, vodDate, crop, combine, args, clipsTxt, clips,
  types, jobs, stages, exportView, clipSession, layout, filmstrip,
  dialogStack, ingest, range, jobFiles, ffmpeg's once).
- `bunx tsc --noEmit` - typecheck.
- End-to-end: load a video by path, mark in/out, draw a crop, export;
  check the job output with ffprobe (duration within 1.5 frames of the
  requested range, expected fps, audio stream when expected, full-tier
  gif/avif at source resolution uncapped, sharable tier's longest edge at
  maxEdge (or the crop's longest edge when smaller) within the size cap,
  avif codec `av1`) and confirm
  `GET /api/videos/<id>/file` answers 206 for a Range request. A
  combined export writes `highlights/<note>-highlights.mp4` plus a
  `sharable/<note>-highlights.mp4` (the sharable one: 30fps, the
  middle-sections file - ~180s of content from 8-15s middles
  per part, longest edge at the first fitting rung starting at the full
  resolution, under 48MB, one file no matter how long the full tier is).
  `out/<videoId>/timestamps.txt` exists after a save AND comes back
  after deleting the export folder and re-exporting.
  Run against
  `bun run prod` - see the dev-mode store gotcha.
- Ingest: drop a file into `ingest/` and refresh - it is moved into
  `uploads/<videoId>/`, registered (banner + auto-selected); a file
  still being written reports pending and ingests on the next refresh;
  an unproberable file is left in place and retried on the next refresh,
  and only after three consecutive failed sweeps lands in
  `ingest/failed/` with a `.err` sidecar. Deleting a source file outside
  the app and refreshing drops the session AND its `thumbs/<videoId>/`
  cache dir (the `out/` dir stays - user data).
