# Export recipes

The full pipeline recipes. The EXACT ffmpeg arguments are pinned by
`test/args.test.ts` and commented in `src/lib/args.ts` - this document is
the narrative, the code is the source of truth. Changing a recipe means
updating the args builder AND its test in the same change.

## MP4

Input seek `-ss <start>`, output cut `-t <dur>`, always re-encode.
`start` is `clip.start` floored to the frame grid (`frameAt` in
`times.ts`), so the first output frame is the frame a player displays at
the in-point, not the first frame after it.

- Video: nvenc (fullres VBR) when available, else libx264 slow.
- Bitrate: source-matched by default
  (`targetVideoKbit(sourceKbit, srcFps, outFps)`), manual kbit allowed.
- Audio: AAC 192k with `asetpts,apad` when the source has audio and the
  clip keeps audio.
- After encoding, container+video durations are verified within
  `DURATION_TOLERANCE_FRAMES` (1.5 frames of the OUTPUT fps - the one
  constant shared with the sharable check in `runner.ts`); one retry; a
  second miss becomes a `job.warning` (the file is kept).

## GIF / AVIF dual tier (never gif/avif-from-VOD)

One shared full-res intermediate mp4 is cut first at the clip's frame
(same floored start as the MP4, crop applied, at `anim.fps`) and feeds
every tier. Each clip with gif and/or avif selected ALWAYS produces two
versions per format:

- **full** tier: full resolution (crop size if cropped, else source size)
  at `anim.fps`, uncapped, at the export dir root;
- **sharable** tier: longest edge scaled to `anim.maxEdge` (`sharableCap`
  picks the axis, so a portrait crop scales the height), capped at
  `anim.maxMB`, in `sharable/`. Sharable gif files carry the winning
  rung's edge suffix (`-<edge>`, e.g. `-750` when the ladder's first
  sub-cap rung is 750px, not the requested maxEdge).

### GIF

Shared `palettegen` from the full-res cut (256 colors, `stats_mode=full`);
full tier = one stage-3 encode at full size@anim.fps, no cap; sharable
tier = the ping-pong quality ladder (`buildLadder`): each edge step
(maxEdge x 1.0, .75, .625, .5, .375, .25, even-floored, capped at the
full tier's longest edge via `sharableCap` and scaled on that axis so it
never upscales) is tried at anim.fps and then at 5/6 x anim.fps (the
recipe's 30 -> 25), highest quality first, taking the first rung whose
file is <= maxMB. Duplicated (edge, fps) pairs from even-floor collapse
at small edges are deduped. An emergency 0.1875-edge rung at the stepped
fps is tried last; if it still exceeds the cap the job fails.

### AVIF

Full tier = one crf30 encode at full size, no cap; sharable tier = the
3-axis ladder (`buildAvifLadder`): the same fps/edge ping-pong grid as
the GIF, repeated per CRF step (25, 29, 33, 36 - CRF only degrades after
the whole grid is exhausted, 48 rungs), first file <= maxMB wins; an
emergency maxEdge@anim.fps@crf40 rung is tried last; if it still exceeds
the cap the job fails. Duration verify uses the winning rung's fps
(sharable check = warn, not retry).

## Combined MP4 (highlights)

MP4 ONLY - a same-name group is ONE job producing ONE mp4 file, never
gif/avif. This job is IN ADDITION to the parts' individual exports,
which the export route always enqueues.

Per part (stage `combo-cut`), a segment `tmp/seg-i.mp4` is cut at the
part's floored frame with `buildComboCutArgs`: crop (if any) then
scale/pad to the group's target size (`comboTarget` = the LARGEST clip's
crop-or-source size, by area - ties: list order - so the biggest part
keeps its own frame and every part lands in the same size; same-aspect
parts scale to fill it, different-aspect parts are centered with
letterbox/pillarbox padding), `fps=N`, `fade=in`/`fade=out` over
`comboFade(dur) = min(0.5s, dur/2)`, `setpts=PTS-STARTPTS`, libx264
ultrafast crf14 (segments must concat frame-accurate). Audio is per
part: source audio with matching `afade` in/out (48kHz AAC), a silent
`anullsrc` track when the part mutes audio, or none at all when the whole
group has no audio.

Then `buildConcatArgs` demuxer-concats the segments (a `concat.txt` list
of `file '...'` lines) into the final mp4 with the normal mp4 video
encoder (nvenc when available, else x264 slow) at the group's fps and
quality (first clip's), `+faststart`; the final encode is
duration-verified against `comboDuration` (sum of per-part durations)
with one retry (stage `mp4-encode`). Output file:
`highlights/<note>-highlights.mp4` - the combined file sits in its own
`highlights/` folder in the export dir (bare name from
`highlightsFileName` in names.ts), never a `clipN-` name, so it can never
collide with a part's own mp4 (part #N owns `clipN-<note>.mp4` and
exports alongside it).

### Sharable tier (an ADDITION to the full file)

ONE short file per group that represents every part - each part
contributes its MIDDLE section (stage `mp4-share-cut`):
`comboShareSections` picks ~180s of content total (8-15s per part by
part count, a shorter part gives its whole length), cut from the part's
pre-cut segment at a fixed 30fps with its own 0.5s fade in/out and the
part's audio (source aac, a silent aac track, or none - uniform, so the
concat demuxer sees one stream). The sections are concat-demuxed straight
through the rung ladder (stage `mp4-share-rung`): re-encoded rung by rung
(top-down) at the fixed 30fps, longest edge scaled to one rung of
`comboShareRungs` (the full tier's own longest edge first, then
1080/768/512/256 - never upscaled, even-floored, deduped; a portrait
group scales the height), a quality-based encode (x264 crf20 / nvenc
**constqp** cq20 - this nvenc build has no `crf` rc value), 96k aac when
the group has audio, and the first file under the 48MB cap
(`COMBO_SHARE_MAX_MB`) wins: `sharable/<note>-highlights.mp4`. Unlike
the gif/avif ladders this runs AFTER the full tier is on disk, so a cap
miss is a `job.warning` (no sharable copy) instead of a failed job. No
part splitting: the full tier stays one file, the sharable tier stays
one file.

## Encoder choice

Probed once per kind and cached in-process (`once` in ffmpeg.ts):

- `nvencAvailable()` - a 320x180 testsrc probe-encode (320x180, not
  64x64: some drivers reject tiny frames even when nvenc works at real
  sizes).
- `avifEncoder()` - a 320x180 testsrc probe-encode into a `.avif`:
  `libsvtav1` preferred, `libaom-av1` fallback; null when neither works
  (AVIF jobs then fail with a clear error, MP4/GIF unaffected).
