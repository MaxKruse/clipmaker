# UI conventions

The frontend tour of `src/app/page.tsx` and `src/components/`. Read this
when touching the page state or a component; the sharp rules that must
not be lost are restated (short) in AGENTS.md.

- `page.tsx` owns all state; components are presentational. Two machines
  are explicit reducers in lib/ (pure, unit-tested): the **export view**
  (`exportView.ts`, consumed through `useExportView`) and the **clip
  session** (`clipSession.ts`, consumed through a `useReducer` in
  page.tsx: previewed clip, back position, timeline focus, live range,
  guided flow step). The **draft model**: a single working `ClipSpec`
  that mirrors the selected committed clip (`updateDraft` writes to
  both); selecting a clip loads it into the draft, so every draft change
  edits the clip in place. The **in/out range is optional**
  (`session.hasRange`): a fresh video starts with none, so playback is
  free. A range becomes live via a timeline drag, I/O, the In/Out
  inputs, adding a clip, or selecting one. Playback loops the range only
  while one is live.
- **Add-clip flow** (guided; `step` in the clip session:
  `"idle" | "set-times" | "crop"`): "Add clip" is always enabled and
  glows (`.attn`) while no clip is selected. It creates the clip
  immediately - at the live range if there is one, otherwise a 5s window
  at the playhead - and selects it. `set-times` glows the Timeline with
  a hint chip; `crop` glows the Stage. `updateDraft` advances the flow:
  a patch touching start/end goes set-times -> crop, a crop patch goes
  crop -> idle. Esc/inert click/back, selecting another clip, video
  switch, import, and delete reset to idle. `.attn` is plain
  (unlayered) CSS in globals.css so it overrides the layered component
  border colors.
- Styling: Tailwind v4 with design tokens in `globals.css`
  (`@theme` colors + `.btn`, `.input`, `.panel`, `.chip` classes). New
  UI must reuse those tokens/classes, not redeclare colors.
- **Player size**: there is no width cap. The Stage is a flex column: a
  video *area* (16:9, width-driven below `xl`; at `xl` and up it fills
  the stage row, see the resizable work area) that holds the video box
  absolutely inset `3.333%` of the area on every side, then the scrub
  bar + transport row in a bottom band with the same horizontal margin.
  The video element is `object-contain` in the box; the crop overlay
  tracks any box size via the ResizeObserver.
- **Keyboard**: the Stage keydown listener ignores INPUT/TEXTAREA/SELECT
  so typing in the In/Out/note inputs stays native; a focused BUTTON
  passes only ArrowLeft/ArrowRight through to the seek handler (space/
  I/O/Esc keep native button behavior). Callbacks reach the listener
  through a `cbRef` updated every render, so the subscription never
  re-subscribes (which would drop a keypress between renders).
- **Range-drag pauses playback**: while an in/out handle, a range move,
  or a new-range draw is in progress, the Timeline reports it via its
  `onDragChange` prop; the page pauses playback (only if it was
  playing) and restores the playing state on release, so the frame
  under the pointer is the exact frame the clip will start on.
- **Clip list scroll cap**: the queue list is capped at 420px (~12
  rows) and scrolls internally below `xl` (`max-h-[420px] xl:max-h-none`);
  at `xl` the grid row already bounds it; rows are compact (`py-1`).
- The stage measures its frame with a ResizeObserver. The crop overlay
  covers the whole stage and is always active: every pointer event on
  the video crops (click = plant a small crop when none exists - a
  click outside an existing crop keeps it - drag = draw, move, 8 resize
  handles); clicking the video never toggles playback. Letterbox clicks
  clamp to the frame in `normalizeCrop`. The crop is drawn as a div rotated
  about its center (`transform: rotate(angle)`); a `rot` handle just outside
  the NE corner turns the crop about its center (new angle = handle's pointer
  angle minus its rest angle). Pointers are converted with `toLocal` (rotated
  into the crop's own frame, where it reads axis-aligned) before the existing
  hit-test/resize math; draw/move/rot read the source frame, resize reads the
  local frame. `OptionsPanel`'s crop section shows the angle and a
  "straighten" button when tilted.
- **Ingest banner**: the page's mount fetch of `/api/videos` carries the
  sweep's `notice` (one line, built by `ingestNotice` in lib/ingest.ts).
  The page shows it under the video loader - `text-ok` when nothing
  failed, `text-danger` when any file was rejected - and makes a
  freshly ingested video the active one (the last one when several
  arrived).
- The Stage has a secondary scrub bar under the video (above the
  transport row): click/drag seeks across the full duration and shows
  the live in/out band. Stage's `inPoint`/`outPoint` props are
  nullable - the page passes `null` while no range is live.
- **Timeline interactions**: click = seek, drag on the empty track =
  draw a new in/out range (live while dragging), drag the range = move
  it, drag its edge handles = resize, right-click on the range = clear
  it (back to free playback). The selection region only renders while a
  range is live. The track shows a zoomable time window (`view` state in
  Timeline.tsx): wheel = zoom at the mouse position (min span 10s, max
  span = whole video, default = whole video), shift+wheel or
  shift+drag = scroll, double-click = fit. When zoomed, a range chip
  and a `fit` button overlay the top-right corner. While a range is
  being drawn/moved near a track edge, the view auto-pans (rAF loop in
  Timeline.tsx): the dragged content's time references shift with the
  view and the live onDraw/onMoveSel callbacks re-fire, so the content
  follows the pointer and the draft stays in sync.
- Clip batch import is client-side: `clipsTxt.ts` parses `m:ss - m:ss
  note` lines (h:mm:ss too) and `# header` sections; with several
  sections only the one whose header contains the active video's file
  name is imported (`sectionForVideo`), otherwise the UI errors instead
  of importing the wrong VOD's clips. Imported clips are clamped to the
  video duration in `page.tsx:importClips`.
- **timestamps.txt auto-save**: there is no export button for it - the
  clips PUT route (the debounced clip save) writes
  `out/<videoId>/timestamps.txt` on every save (one
  `<start> - <end> <note>` line per clip, via `timestampsForVideo` in
  clipsTxt.ts, times through `formatClipTime`, notes flattened to one
  line); the runner re-writes it after every successful export job
  (`saveTimestampsMirror` in jobFiles.ts), so deleting the export folder
  and re-exporting brings it back. Empty list deletes the file; a
  failed write never fails the save.
- **Clip preview jump**: clicking a clip in the queue seeks the player
  to the clip's start and stores the pre-jump position
  (`session.returnTo` in the clip session, kept across consecutive clip
  clicks). The timeline also frames the clip with 5s of margin on each
  side (`focus` prop, `focusWindow` in times.ts) so the in/out points
  can be fine-tuned on the track; the focus is cleared on leave/switch
  and the view itself only resets via double-click/fit or a video
  switch. Returning is by clicking inert background (a document-level
  click listener ignores `closest("[data-clips-panel], [data-clip-options],
  [data-player], [data-layout], button, input, a, select, textarea")`),
  pressing `Esc` (only while the export modal is closed - the modal
  captures Esc first), or the back button in the Stage transport row.
  Leaving the preview also deselects the clip and clears its range
  (back to free playback). Playing, setting in/out, scrubbing, and
  switching/removing the video clear the pending return.
- Times in the clip list and the timeline in/out chip are shown with
  milliseconds (`formatTime`); the zoom-window label and the preview
  back button use `formatShort`.
- Jobs are polled every 1s; the video list is loaded once. Clips are
  per-video project files: loaded for the active video, saved with a
  500ms debounce. `clipsLoadedFor` (page.tsx state) is the single load
  gate: it keeps the clip list from showing the previous video's clips
  on a switch and keeps the save effect from writing a record that has
  not been loaded yet (the initial empty one). The load for a video is
  GATED ON THE PENDING SAVE FLUSH for the same video (`flushPendingSave`
  returns its promise): an A -> B -> A switch within the debounce
  window would otherwise reload the pre-edit list and the debounce
  re-save it over the edit.
- Layout: below `xl` the page scrolls (root `min-h-screen`). At `xl`
  and up the app is **viewport-fitted** (root `xl:h-screen`): the work
  area is a **resizable grid** (see the next bullet) that fills the
  viewport, and the stage row stretches to the leftover height, so the
  whole app scales to the actual screen instead of assuming one monitor
  size. By default nothing overflows (no page scroll); the root does
  NOT clip (`overflow-hidden` would cut off pinned panels), so if the
  user pins a panel past the available space the page scrolls instead
  of losing regions - left column stacks Stage, Timeline, Filmstrip;
  right column stacks OptionsPanel over ClipQueue, and ClipQueue fills
  the right column's leftover with its list scrolling inside (the list
  itself is capped at 420px below `xl`). Export progress is not in the
  layout flow at all: a front-and-center modal (ExportModal) with a
  bottom-right pill (ExportPill) as its minimized form; both hide
  themselves when no job exists.
- **Resizable work area (seams)**: at `xl` and up, draggable grips
  (the `Resizer` component, `role="separator"`, `data-layout` on the
  root) sit between the five regions: stage|timeline, timeline|
  filmstrip, left|right column, options|clipqueue. A drag sets one
  region's fixed pixel size - the page records the region's size at
  drag start (`offsetHeight`, measured; the column width comes from
  `layout.right`) and applies the total pointer delta clamped by
  `LAYOUT_LIMITS` (right 280-800, stage 140-1200, strip 72-320, options
  96-900). Direction follows the seam: a region above/left of its seam
  (stage, options) grows with the drag, a region below/right of it
  (filmstrip, right column) shrinks with it. Double-click resets that
  region to its default sizing (the stage stretches to the leftover
  height again; the others return to their default sizes). The sizes
  live in `layout` state (a `WorkLayout`: `right` number,
  `stage`/`strip`/`options` number-or-null, null = default sizing) and
  feed the grid templates through CSS variables: outer
  `xl:grid-cols-[minmax(0,1fr)_auto_var(--lm-col,400px)]`, left
  `xl:grid-rows-[var(--lm-stage,minmax(0,1fr))_auto_auto_auto_var(--lm-strip,108px)]`,
  right `xl:grid-rows-[var(--lm-opts,minmax(0,auto))_auto_minmax(0,1fr)]`
  - an unset stage stretches to the leftover viewport height (dynamic
  scaling), an unset options takes its natural height (its form scrolls
  internally on short screens); pinning the stage to a px height leaves
  the leftover space below the filmstrip. Both column divs carry
  `min-h-0`: they are grid items of the outer grid, and without it
  their automatic minimum (min-content height) would force the outer
  implicit row past the viewport - in intrinsic sizing the queue's
  `1fr` row measures as auto, so a long clip queue would push the whole
  work area off-screen; with `min-h-0` the queue row shrinks instead
  and the clip list scrolls inside. The layout persists to
  localStorage (`clipmaker.layout.v1`) on drag end and reset via
  `saveLayout`/`loadLayout` (lib/layout.ts, self-healing on corrupt
  storage). Seams are hidden below `xl`. The seam `Resizer` must NOT
  `preventDefault` on `pointerdown` - cancelling it suppresses the
  compat mouse events the double-click reset relies on; selection is
  already covered by the body `user-select: none` set during a drag.
  The inert-background click handler ignores `[data-layout]` (seam
  clicks never leave a clip preview). The Stage's video area fills its
  stage row at `xl` (the video letterboxes inside); the Filmstrip row
  defaults to 108px and its thumbnails scale with the row height; the
  OptionsPanel scrolls its form when the row is shorter than its
  natural content.
- **Shared dialog chrome**: the three modals (export, videos, export
  plan) plus the settings modal render through `Dialog.tsx`, which owns
  the backdrop click, the capture-phase Esc handler (only the topmost
  open dialog acts on it - the open-order stack in `lib/dialogStack.ts`),
  and focus-in/focus-restore. Each modal passes its overlay alignment,
  panel size classes, aria label, and its close-button focus ref; the
  capture keeps Esc/backdrop from leaking to the clip preview
  underneath.
- **Export plan modal**: the ClipQueue "Export N clips" button does NOT
  start the export - it opens `ExportPlanModal` (`aria-label="Export
  clips"`): a compact centered card dialog (max-w-4xl, not full-screen)
  with a bordered header, a scrollable two-pane body, and a bordered
  footer. Left pane "clips": cards (rounded-lg, custom accent-filled
  checkbox drawn with CSS - the input stays sr-only; an unticked card
  is dimmed at opacity-50); the time + chips share one wrappable group
  (min-w-0, `wrap`) so long timestamps with all three formats never
  overflow the card. Right pane "combined highlights": ALWAYS visible -
  one REAL checkbox card per multi-clip same-name group (note, part
  count + duration via `comboDuration` + `videoFps`, mp4 chip, "parts
  export individually too · 0.5s fade per part" hint). Combined files
  are ADDITIONS to the parts, never replacements: a ticked group
  exports ONE mp4 highlights file of its SELECTED (left-pane-ticked)
  parts. Card states: unticked = dimmed (opacity-50, shows the
  group's full part count); ticked with 2+ selected parts = active
  (accent border, shows the selected part count + their duration,
  `parts of N parts` when partial); ticked with 0-1 selected parts =
  dimmed (opacity-70, "select 2+ to combine"). The header row has
  "select all" (clips) plus a "combine all groups" checkbox, rendered
  only when at least one group exists. The footer shows
  `N clips - M exports`, where M = selected clip count + ticked groups
  with 2+ selected parts. "Start export" (disabled at 0 selected) calls
  `startExport(selected, combineKeys)` in page.tsx, which POSTs
  `/api/export` with the ticked clips + `combine` = the note keys of
  the ticked groups, then closes the plan and opens the export view.
  Like the export modal it captures Esc/backdrop so they do not leak
  to the clip preview underneath.
- **Export modal**: the view is the `exportView` reducer (modal | pill;
  with no jobs nothing renders). It opens on export and auto-opens on
  an inactive->active jobs transition (covers page reload mid-export).
  While the modal is open it is the topmost layer: the header button
  (reads `minimize` while any job is active, `close` once settled),
  `Esc`, and a backdrop click all dismiss it (to the pill - "N
  exporting" / "N failed" / "N done" plus "show" - whose `show` reopens
  it). The modal captures both so they do not leak to the clip preview
  underneath (capture-phase keydown with `stopPropagation`; the
  backdrop click also stops the page's inert-background click): while
  the modal is open, Esc does not leave the preview. The panel is a
  real dialog (`role=dialog`, `aria-modal`): focus moves to the close
  button on open and returns to its previous holder on close. The batch
  tri-state dot (spinner / ok / failed) in the header and in the pill
  is the shared `JobStateDot` (ExportModal.tsx). Header shows the
  overall percentage (mean over jobs); each row shows a status chip,
  the stage text, a per-job bar, and the finished outputs as download
  buttons (file name + size; the sharable tier is recognizable by its
  `-<edge>` name suffix); a `cancel` button (queued/running rows only)
  calls `DELETE /api/jobs/[id]` and the row then settles as
  `error: "cancelled by user"`. Footer: `clear finished` (shown only
  when settled with at least one done; clears done/error jobs and
  dismisses the view when nothing but success remains).
- **OptionsPanel sections**: clip options are grouped into titled
  sections (Note, In/Out, Formats, MP4 video, GIF / AVIF, Crop) with
  progressive disclosure - the MP4 section (frame rate, audio,
  quality) renders only when the clip's formats include mp4, and the
  GIF / AVIF section (frame rate, sharable size cap, sharable max edge)
  only when gif/avif is selected.
- **Settings modal (new-clip defaults)**: the top bar's `Settings`
  button (`ml-auto`) opens `SettingsModal` - the Dialog-chrome modal
  for the persisted `ClipDefaults` (`.data/defaults.json`): an intro
  paragraph, a live one-line summary of the current settings
  (`defaultsSummary` in lib/types.ts, pure, unit-tested), and the
  sections Formats (pills, at least one kept by `toggleFormatIn`, with
  a hint per selected format), MP4 video (frame rate, audio,
  source/manual quality + kbit input), and GIF / AVIF (frame rate, size
  cap, max edge, the slow-encode note). Every change PUTs
  `/api/defaults` immediately via the page's `saveDefaults` (no
  debounce); the page fetches the object on mount. `Reset to defaults`
  (btn-danger) asks a native `confirm()` first, then
  `onChange(defaultClipDefaults())`. New drafts (`freshDraft` in
  page.tsx) and imported clips are created via
  `defaultClip(note, defaults)`; existing clips keep their own
  settings, and "Add clip" with a clip selected still copies that
  clip's draft (the draft model is unchanged).
- **AVIF duration warning**: AV1 encodes are slow, so a clip whose
  formats include avif warns by length - yellow (`text-warn`) above
  45s, red (`text-danger`) above 60s. The OptionsPanel shows it in the
  GIF/AVIF section; ClipQueue rows show a matching `slow` chip. The
  level comes from `avifDurationLevel` (lib/avif.ts, pure,
  unit-tested).
