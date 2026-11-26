# API reference

Thin route handlers over `store`/`runner` (src/app/api/**). The sharp
rules (page load = ingest trigger, the runner as the only ffmpeg
caller, the export-dir path rule) live in AGENTS.md.

- `POST /api/videos` - JSON `{path}` registers a local file (probed,
  referenced in place); a raw body (no multipart) with an `x-filename`
  header uploads it into `uploads/`. 64GB cap, backpressure handled.
- `GET /api/videos` - runs the ingest-folder sweep (`sweepIngest`,
  single-flight), sweeps orphaned filmstrip caches
  (`removeOrphanedThumbs`), and then returns
  `{ videos, ingested, rejected, pending, notice }`; `notice` is the
  one-line banner text (contract pinned by `test/ingest.test.ts`), null
  when the sweep found nothing. `DELETE /api/videos/[id]` - remove
  (deletes the upload dir only when `uploaded`, plus the video's
  export dir `out/<videoId>/` and filmstrip cache `thumbs/<videoId>/`);
  first cancels the video's queued/running exports (queued settle at
  once, running are killed and their late settle is a no-op on the
  gone video), then drops ALL of the video's jobs.
- `GET /api/videos/[id]/file` - byte-range streaming (206); the `<video>`
  element needs this for seeking.
- `GET/PUT /api/videos/[id]/clips` - the video's project file: fetch
  the persisted clip list, or replace it (every clip validated through
  `toClip` in `lib/clips.ts`, max 500 clips). 404 for unknown videos.
  GET re-runs stored rows through `toClip`, so legacy shapes (the old
  `gif` key) self-migrate to `anim` on read. PUT also mirrors the list
  to `out/<videoId>/timestamps.txt` via `saveTimestampsMirror`
  (one `<start> - <end> <note>` line per clip) - best-effort: an empty
  list deletes the file, and a failed write never fails the save.
- `GET/PUT /api/defaults` - the new-clip defaults: GET returns the
  `ClipDefaults` object directly; PUT sanitizes the body through
  `toDefaults`, persists it to `.data/defaults.json`, and returns
  `{ok: true}`.
- `POST /api/preview` - `{videoId, time, crop}` -> one cropped JPEG at
  <=480px; `crop` is `{x,y,w,h,angle}` (a tilted crop is straightened, like
  the export); `time` is floored to the frame grid, the same frame the
  export will cut at.
- `POST /api/export` - `{videoId, clips, combine?, nos?}` - validates
  each clip server-side (start clamped to duration, end clamped to
  duration+0.5, min 0.2s). EVERY
  clip always gets its own job (`clipNo` = the clip's 1-based position in
  the video's clip list). `nos` is an optional parallel array of those
  positions (sent by the client from the in-memory queue); each entry
  falls back to the subset index when missing or invalid.
  `combine` (optional) is an ARRAY of note keys (canonical form:
  trimmed + lowercased, `combineKey` in lib/combine.ts): for each
  key, the same-note group (empty note = never grouped) with 2+
  parts gets ONE ADDITIONAL job carrying `clips` - a combined MP4
  compilation export (see the recipe above); `clipNo` = the group's
  first clip's queue position. Requested singletons are skipped - their
  solo job above already covers them.
- `GET /api/jobs` (newest batch first, clip order within a batch),
  `DELETE /api/jobs` (clear finished),
  `DELETE /api/jobs/[id]` - cancel one queued/running job: sets the
  cancel flag, kills the job's ffmpeg process tree, settles the job as
  `error: "cancelled by user"` and removes its `.tmp/<id>/` (returns
  `{cancelled: false}` when the job is already settled); 404 for an
  unknown id.
  `GET /api/jobs/[id]/file?k=mp4|gif|avif&t=full|sharable|preview` (attachment
  download; `k` picks the kind, `t` the tier - a link without `t`
  keeps the first match; content-type per extension - `video/mp4`,
  `image/gif`, `image/avif`; the filename header is the basename, so
  sharable outputs with a relative `name` download cleanly). The file
  is resolved through `outputPath` (out/<videoId>/ plus the dated
  subfolder when the id carries one).
