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

A local web app that cuts clips from local videos and exports them as
MP4 and/or GIF and/or animated AVIF (GIF/AVIF in a full tier plus a
size-capped sharable tier), or combined: clips sharing a note merged
into ONE mp4 compilation file (0.5s fades per part) with a short
middle-sections preview alongside. Next.js 15 App Router, React 19,
TypeScript, Tailwind v4 (hand-rolled UI components, no component
library). All ffmpeg work runs server-side via `child_process`; the
browser only handles UI, preview frames, and download links.

## Read before writing code

- **docs/api.md** - in full, before touching any route under
  `src/app/api/` or anything that shapes request/response JSON.
- **docs/export-recipes.md** - in full, before touching `src/lib/args.ts`,
  `runner.ts`, `ladder.ts`, `combine.ts`, `crop.ts`, or the export naming
  in `names.ts`.
- **docs/ui-conventions.md** - in full, before touching `src/app/page.tsx`
  or anything under `src/components/`. The sharp rules below are a
  summary; when they disagree, the docs and the code win.

## Architecture

The code is layered so that everything testable is pure:

```
src/lib/times.ts    time parsing/formatting + frameAt + formatClipTime + clip focus window
src/lib/bitrate.ts  source-kbit detection + fps-scaled target kbit + resolveOutKbit
src/lib/ladder.ts   GIF ping-pong shrink ladder (edge x fps rungs, deduped) +
                    AVIF 3-axis ladder + sharableCap (maxEdge vs the full tier's
                    longest edge, and the scale axis)
src/lib/names.ts    safe output file names: clipN[-note].mp4|avif,
                    clipN[-note]-<edge>.gif, the compilation names
                    (combinedBase - the note sanitized like clip names plus a
                    collision-safe -x<hash> of the raw note whenever sanitizing
                    changed it; combinedFileName <note>-combined.mp4,
                    previewFileName <note>-Preview.mp4) + RFC 6266 disposition
src/lib/vodDate.ts  broadcast date in a VOD file name -> dated video id
                    (<date>_<random> via newVideoId) + dateFromVideoId
src/lib/crop.ts     CropBox model (x,y,w,h + rotation angle), clampAngle,
                    cropCenter, cropBBox, normalizeCrop (even, clamped,
                    >=16px; a tilted crop shrinks so its EVENED bounding box
                    fits the frame, re-centered via parity-safe placement),
                    cropFilter (the straighten recipe)
src/lib/clipsTxt.ts parse Clips .txt notes (time ranges + # sections) + the
                    inverse timestampsForVideo serializer (round trip pinned)
src/lib/clips.ts    client-side sanitizers: toClip (untrusted clip -> ClipSpec)
                    and toDefaults (untrusted defaults -> ClipDefaults)
src/lib/combine.ts  same-name grouping (groupCombine), combo math (duration,
                    0.5s fades, target size) for the combined export, plus the
                    preview-tier ladder (comboShareRungs: the full tier's own
                    longest edge first, then the fixed 1080/768/512/256,
                    even-floored; COMBO_SHARE_FPS/CRF/MAX_MB) and the
                    middle-section rule (comboShareSections)
src/lib/args.ts     ffmpeg argument builders (mp4/gif/avif stages/preview,
                    combo cut, preview section cut, preview re-encode, concat)
src/lib/jobs.ts     client-side only (MUST stay pure - see gotchas): export
                    list display order (newest batch first, clip order within),
                    tier resolution (resolveTier), download-link lookup
src/lib/jobFiles.ts server-only (node:): exportDir/outputPath (the ONE home of
                    the dated export-dir rule) + saveTimestampsMirror +
                    outputsGone + safeOutputName (only a bare name, sharable/,
                    Compilations/, or Compilations/Preview/ may reach the out
                    dir - loadJobs drops rows carrying anything else)
src/lib/stages.ts   structured export job stages (JobStage) + stageText
src/lib/exportView.ts / clipSession.ts   the two UI state machines
src/lib/layout.ts   resizable work-area layout (WorkLayout, LAYOUT_LIMITS,
                    clamp, load/save with injected IO)
src/lib/avif.ts     avifDurationLevel (length-based AVIF encode warning)
src/lib/range.ts    HTTP byte-range parsing (parseRangeHeader)
src/lib/types.ts    VideoInfo, ClipSpec, ClipDefaults, Job, MIN_CLIP_SECONDS
                    + defaultClip / defaultClipDefaults / toggleFormatIn /
                    defaultsSummary
src/lib/human.ts    human sizes ("4.7 MB")
src/lib/dialogStack.ts last-opened-dialog-wins Esc stack
      -- everything above is pure and unit-tested (test/*.test.ts) --
src/lib/filmstrip.ts filmstrip sampling plan (pure) + server-only single-flight
                    thumbs/ generation pool + removeThumbsForVideo +
                    removeOrphanedThumbs
src/lib/ffmpeg.ts   ffmpeg/ffprobe discovery + spawn wrappers,
                    probeVideo/ProbeResult, progress, encoder probes (nvenc,
                    avif; one-shot via once()), and the cancel registry
                    (runTracked + killProcessTree) that lets the runner
                    interrupt a job mid-encode
src/lib/ingest.ts   ingest-folder sweep: pure helpers + the single-flight
                    sweepIngest (server-only - the page must never import it)
src/lib/store.ts    disk-backed session store (.data/) + dir constants;
                    self-heals stale rows on load (rewrites the JSON files)
src/lib/runner.ts   bounded export job pool (CLIPMAKER_CONCURRENCY, default 2;
                    the only ffmpeg caller) + cancelJob + runCombined (the
                    compilation pipeline: Compilations/ + Compilations/Preview/)
src/app/api/**      thin route handlers over store/runner
src/components/**   UI, all "use client"; useExportView.ts wraps the
                    exportView reducer; Dialog.tsx is the shared modal chrome;
                    SettingsModal.tsx is the new-clip defaults page
src/app/page.tsx    page state owner (videos, clips, draft, jobs polling);
                    the export view and clip session run as explicit machines
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
  to +/-45) is the crop's rotation about its center. The UI converts
  between screen px and source px via the measured frame rect and a
  `toLocal` (pointer rotated into the crop's own frame); the preview
  route re-normalizes server-side, so a stale UI crop can never produce
  an invalid filter.
- **A tilted crop is straightened on export, not exported tilted.** The
  output is the crop's content at 0 degrees, sized `w x h`, with no black
  corners: ffmpeg crops the crop's axis-aligned bounding box, `rotate`s
  it about the crop center by `-angle`, then crops the centered `w x h`.
  At `angle=0` this is byte-identical to the plain `crop=w:h:x:y`, so
  existing clips are untouched. `normalizeCrop` re-centers/shrinks a
  tilted crop so its EVENED bounding box stays inside the frame (the
  chain crops the evened box, so the evened size is what must fit - on
  odd-sized sources the raw fit can overflow by 2px); a frame too small
  for the 16px minimum at the tilt gets a sub-minimum even crop, and a
  zero-slack fit with an unplaceable odd center parity gives that axis
  2px of slack.
- **Progress events use `-progress pipe:1`**; both `run` and
  `runProgress` in ffmpeg.ts parse it. `runProgress` takes the expected
  total duration and reports 0..100. It reads ONLY `out_time_us`:
  ffmpeg's `out_time_ms` field is ALSO microseconds - parsing it as ms
  pins the bar at the 0.99 clamp for the whole stage. Every encode
  builder must carry `-progress pipe:1`.
- **The export-dir path rule has exactly one home**: `exportDir` /
  `outputPath` (jobFiles.ts) - dated ids get a subfolder of just that
  date under the video folder. The runner, the download route, and
  `outputsGone` all resolve through it. `timestamps.txt` is NOT in that
  folder: it always sits at the video root, rewritten by the clips PUT
  route on every save AND by the runner after every done job
  (`saveTimestampsMirror`, best-effort).
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
  once at load. `uploaded` marks files copied into `uploads/` (safe to
  delete). `id` is generated by `newVideoId(basename)` (lib/vodDate.ts):
  `<date>_<random>` when the source file name carries a broadcast date,
  plain `<random>` otherwise. The date comes back out of the id via
  `dateFromVideoId`; videos registered before that stay on their legacy
  random id and flat layout.
- `ClipSpec { id, note, start, end, crop, formats, audio, fps, quality,
  anim }` - one clip. `crop` is `CropBox | null` = `{x,y,w,h,angle}`.
  `formats` is a non-empty subset of `"mp4" | "gif" | "avif"`. `fps`
  (default 60; 25/30/60) is the MP4 frame rate; `quality { mode:
  "source" | "manual", kbit }` applies to MP4; `anim { fps, maxMB,
  maxEdge }` applies to GIF/AVIF (the shared intermediate's frame rate
  and the full tier's; maxMB/maxEdge cap the sharable tier, never
  upscaling). New and imported clips are created by
  `defaultClip(note, defaults)` from the user's persisted `ClipDefaults`.
- `ClipDefaults { formats, audio, fps, quality, anim }` - the export
  options new and imported clips are created with; user-editable via the
  Settings modal, persisted in `.data/defaults.json`, validated by
  `toDefaults`. Existing clips keep their own settings.
- `Job { id, videoId, videoName, clip, clipNo, clips?, status, stage,
  pct, outputs, warning?, error?, createdAt }` - `clips` (present only
  on combined jobs) is the same-name group; the job produces ONE mp4
  compilation, `clip` = the group's first member (with `formats` forced
  to `["mp4"]` for display). `clipNo` is the 1-based position of that
  first member in the video's clip list (the group's queue position).
  `status` is queued/running/done/error. `stage` is the structured
  `JobStage` while running, null when settled; the modal renders it via
  `stageText`. `outputs` is an array of `{ kind: "mp4" | "gif" | "avif",
  name, size, tier?: "full" | "sharable" | "preview" }` for files under
  the video's `out/<videoId>/`; for dated videos `name` may be a
  relative path like `sharable/clip1-note.gif`,
  `Compilations/<note>-combined.mp4`, or
  `Compilations/Preview/<note>-Preview.mp4`; `tier` is absent on old
  jobs. Combined jobs push the full compilation in its own folder
  (`tier: "full"`) and, when the preview ladder fits, the preview
  (`tier: "preview"`) - ONE entry each, no matter how long the full
  tier is.
- `Job.stage` is null when the job settles, including on error.

## Disk layout (all gitignored, created lazily)

- `.data/videos.json`, `.data/jobs.json`, `.data/clips.json` - persisted
  session state. `.data/defaults.json` - new-clip defaults
  (`ClipDefaults`); created on first save, loaded through `toDefaults`
  so a corrupt file self-heals to the shipped defaults.
- `uploads/<videoId>/<name>` - uploaded files.
- `ingest/` - drop folder for huge files. Not created by the app (the
  user creates it, optionally at another location via
  `CLIPMAKER_INGEST_DIR`); the next page load moves proberable files
  into `uploads/<videoId>/` and registers them. The pending / still-
  writing / quarantine behavior: see the gotchas and docs/api.md.
- `out/<videoId>/...` - per-video export dir. Dated videos (see
  VideoInfo) put every export file in a subfolder of just that date:
  `out/<videoId>/<date>/clipN[-note].mp4|gif|avif` (full tier),
  `out/<videoId>/<date>/sharable/` (sharable copies),
  `out/<videoId>/<date>/Compilations/` (combined files, one per same-name
  group) and `out/<videoId>/<date>/Compilations/Preview/` (their
  previews); undated and legacy videos keep the flat layout directly in
  `out/<videoId>/`. `timestamps.txt` (clips mirror) always sits at the
  video root, rewritten on every clip save and after every done export
  job of the video.
- `thumbs/<videoId>/` - filmstrip JPEG frame cache, regenerated on
  demand, deleted with the video (DELETE route) or swept as an orphan
  on the next page load (GET /api/videos -> removeOrphanedThumbs).
- `docs/example/cat-lapping.webm` - the README screenshot example
  video (see the reshoot rules at the top); restore from the Wayback
  URL if missing.
- `.tmp/<jobId>/` - per-job temp files, deleted in a `finally`.

## Export recipes (summary)

Full narrative and the exact argument recipes in
**docs/export-recipes.md** (must-read, see above). Sharp summary:

- **MP4**: frame-floored cut, always re-encoded; nvenc (fullres VBR)
  when available else libx264 slow; source-matched or manual kbit;
  AAC 192k + `asetpts,apad` with audio. Duration verified within
  1.5 frames, one retry, second miss = warning (file kept).
- **GIF / AVIF**: one shared full-res intermediate mp4 (clip frame,
  crop, `anim.fps`) feeds every tier. ALWAYS two versions per format:
  a **full** tier (full resolution, uncapped, export dir root) and a
  **sharable** tier (longest edge at `anim.maxEdge` via `sharableCap`,
  capped at `anim.maxMB`, in `sharable/`).
- **Combined MP4 (compilations)**: MP4 only, ONE job per same-name
  group with 2+ parts, IN ADDITION to the parts' individual exports.
  Per-part frame-accurate segments (group target size, 0.5s fades,
  uniform audio) concat-demuxed into
  `Compilations/<note>-combined.mp4` with the normal encoder. Preview
  tier (an addition): each part's MIDDLE section (~180s of content
  total, 8-15s per part) re-cut at fixed 30fps with its own fades,
  concat-demuxed straight through the longest-edge rung ladder
  (full tier's edge first, then 1080/768/512/256), first file under
  48MB wins: `Compilations/Preview/<note>-Preview.mp4`. Runs AFTER the
  full tier, so a cap miss is a warning, not a failure.
- **Compilation names are collision-safe**: `combinedBase` appends a
  `-x<hash>` of the raw note whenever sanitizing changed the note, so
  two different notes that sanitize alike ("a/b" and "a b") land on
  different files, and re-exporting a subset of the same group lands on
  the same names (the hash is a pure function of the note - no
  randomness, no batch state).
- **Encoder choice** is probed once per kind and cached in-process:
  `nvencAvailable()` and `avifEncoder()` (libsvtav1 preferred,
  libaom-av1 fallback; null = AVIF jobs fail cleanly).

## API

Full reference in **docs/api.md** (must-read, see above). Sharp rules only:

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
  process tree); `GET /api/jobs/[id]/file?k=..&t=..` (t =
  full|sharable|preview) resolves through `outputPath`, so a dated id
  serves from the date subfolder.

## Frontend conventions (sharp rules only)

The full per-component tour lives in **docs/ui-conventions.md**
(must-read, see above). The rules that must not be lost, short:

- `page.tsx` owns all state; components are presentational. Two
  explicit machines (pure, unit-tested lib/ reducers): the **export
  view** (`exportView.ts` via `useExportView`) and the **clip
  session** (`clipSession.ts`). **Draft model**: one working
  `ClipSpec` mirroring the selected committed clip; the in/out range
  is OPTIONAL (`session.hasRange`).
- **Add-clip flow**: "Add clip" creates the clip immediately and
  selects it (glowing `.attn` guides set-times, then crop);
  Esc / inert click / another selection / video switch / import /
  delete reset it. `.attn` is plain (unlayered) CSS so it overrides
  the layered component borders.
- **Crop rotation**: `CropOverlay` draws the crop rotated about its
  center, hit-testing via `toLocal`, a `rot` handle turns it; the
  OptionsPanel crop section shows the angle + "straighten" when
  tilted.
- Styling: Tailwind v4 design tokens in `globals.css` (`@theme`
  colors + `.btn`/`.input`/`.panel`/`.chip`). New UI reuses
  tokens/classes, never redeclares colors.
- **Keyboard**: the Stage keydown listener ignores INPUT/TEXTAREA/
  SELECT; a focused BUTTON passes only ArrowLeft/ArrowRight through;
  callbacks reach the listener via a `cbRef` (the subscription never
  re-subscribes).
- **Range-drag pauses playback**, so the frame under the pointer is
  the exact frame the clip will start on.
- **Inert-background click** leaves the clip preview; the listener's
  `closest()` ignore list must grow with every new click-ignorable
  region (current list in the doc).
- **Clips are per-video project files**: 500ms save debounce; a
  pending save for video A must LAND before a reload of A (the load
  effect awaits `flushPendingSave()` for the same id), or the reload
  re-saves the pre-edit list over the edit. Jobs are polled every 1s.
- **timestamps.txt** has no button: written by the clips PUT route on
  every save and by the runner after every done job.
- Layout: below `xl` the page scrolls; at `xl`+ the app is
  viewport-fitted with a **resizable work area** (`Resizer` seams,
  `LAYOUT_LIMITS`, localStorage via `lib/layout.ts`): the seam
  `Resizer` must NOT `preventDefault` on `pointerdown` (the
  double-click reset needs the compat mouse events); both column
  divs carry `min-h-0`; the root must NOT clip (`overflow-hidden`
  would cut off pinned panels).
- **Shared dialog chrome** (`Dialog.tsx`): backdrop click, stacked
  Esc (topmost wins, `dialogStack.ts`), focus-in/restore; all four
  modals render through it.
- **Export plan modal** opens on "Export N clips": clip cards with
  checkboxes + the "compilations" pane (one checkbox per multi-clip
  same-name group); a ticked group ADDS one combined mp4 of its
  SELECTED parts on top of the parts' exports; footer `N clips -
  M exports`.
- **Export modal / pill**: the `exportView` machine (modal | pill);
  rising-edge auto-open; per-job cancel settles `error: "cancelled by
  user"`; "clear finished" only when settled with at least one done.
- **OptionsPanel** uses progressive disclosure; the **Settings modal**
  edits the persisted new-clip defaults (every change PUTs
  immediately); the **AVIF duration warning** (yellow >45s, red >60s,
  `avifDurationLevel`) shows in the panel and as a `slow` chip.

## Gotchas

- **`jobs.ts` is imported by client components** (page, ExportModal,
  ExportPill) and must never gain a runtime `node:` import - `next build`
  fails with `UnhandledSchemeError` (dev mode does not catch it).
  Server-only job helpers live in `jobFiles.ts` (which also may not be
  imported by client code).
- **typescript is pinned to ^5.9** - TS 7 breaks Next 15's config
  transpile. Do not bump it.
- **Ingest "still writing" has two triggers**: a size change during the
  probe, or the rename failing with EBUSY/EPERM/EACCES
  (`classifyMoveFailure`) because the writer still owns the file. The
  size check alone misses write stalls, so the errno class is the
  backstop - both report the file as pending, not rejected.
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
  were deleted by hand (`outputsGone` in lib/jobFiles.ts) are dropped,
  jobs whose video no longer exists are dropped, running/queued jobs
  become errored ("server restarted before the job finished"), and clip
  lists for videos that no longer exist are dropped. Each of the
  `.data` JSON files is rewritten whenever a row is dropped/migrated,
  so the disk matches the in-memory sessions. `store.updateJob` no-ops
  for a job whose video is gone. Temp files in `.tmp/` of a dead job are
  orphaned and can be removed; legacy jobs.json rows with a string
  `stage` migrate to null.
- **Self-heal never deletes `out/<videoId>/`.** A dropped session's
  export files are FINISHED EXPORTS (user data, potentially GBs): only
  the user's own DELETE removes them. The filmstrip cache IS pure
  cache, so `GET /api/videos` sweeps orphaned `thumbs/<videoId>/` dirs
  via `removeOrphanedThumbs`. Do not "help" by deleting out/ on
  self-heal.
- The MP4 stage encodes directly into `out/<videoId>/` (not a temp
  file), so a job that is cancelled or errors mid-MP4-encode leaves a
  partial `.mp4` behind in `out/` (it is not in the job's `outputs`).
  GIF/AVIF/preview stages only write to `out/` after the whole tier
  succeeds, so they are clean.
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
  store and runner modules** (one module registry per route): an export
  enqueued via `/api/export` runs to completion and writes its files,
  but `/api/jobs` serves its own registry's store, which healed the
  still-running jobs as "server restarted before the job finished".
  Export e2e verification must run against `bun run prod` (one server
  bundle, one store), where jobs poll live.

## Verification

- `bun test` - 311 unit tests over the pure libs (times, bitrate,
  avif, ladder, names, vodDate, crop, combine, args, clipsTxt, clips,
  types, jobs, stages, exportView, clipSession, layout, filmstrip,
  dialogStack, ingest, range, jobFiles, ffmpeg's once).
- `bunx tsc --noEmit` - typecheck.
- End-to-end: load a video by path, mark in/out, draw a crop, export;
  check the job output with ffprobe (duration within 1.5 frames of the
  requested range, expected fps, audio stream when expected, full-tier
  gif/avif at source resolution uncapped, sharable tier's longest edge
  at maxEdge (or the crop's longest edge when smaller) within the size
  cap, avif codec `av1`) and confirm
  `GET /api/videos/<id>/file` answers 206 for a Range request. A
  combined export writes `Compilations/<note>-combined.mp4` (one file,
  all parts, 0.5s fades) plus `Compilations/Preview/<note>-Preview.mp4`
  (30fps, the middle-sections file - ~180s of content from 8-15s
  middles per part, longest edge at the first fitting rung starting at
  the full resolution, under 48MB, one file no matter how long the full
  tier is). `out/<videoId>/timestamps.txt` exists after a save AND
  comes back after deleting the export folder and re-exporting.
  Run against `bun run prod` - see the dev-mode store gotcha.
- Ingest: drop a file into `ingest/` and refresh - it is moved into
  `uploads/<videoId>/`, registered (banner + auto-selected); a file
  still being written reports pending and ingests on the next refresh;
  an unproberable file is left in place and retried on the next refresh,
  and only after three consecutive failed sweeps lands in
  `ingest/failed/` with a `.err` sidecar. Deleting a source file outside
  the app and refreshing drops the session AND its `thumbs/<videoId>/`
  cache dir (the `out/` dir stays - user data).
