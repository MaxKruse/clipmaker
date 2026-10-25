# clipmaker

A local web app for cutting clips out of your own videos. Load a video from
your disk (or upload a file), scrub it, mark in/out points, optionally crop
the frame, mute the audio, pick a quality and frame rate, and export each
clip as an MP4 and/or a GIF.

Everything runs on your machine: the video files never leave it, and
exports are encoded with your local `ffmpeg` (NVENC GPU encoding is used
automatically when available).

## How to run

Prerequisites:

- [Bun](https://bun.sh) on your PATH
- `ffmpeg` and `ffprobe` on your PATH (or set the `CLIPMAKER_FFMPEG` /
  `CLIPMAKER_FFPROBE` environment variables to their paths; a Chocolatey
  install location is also tried as a fallback)

```
bun install
bun run dev
```

Then open **http://localhost:10100**.

For a production build: `bun run build && bun run start` (same port).

## How to use it

1. **Load a video** - either type a local file path (recommended for big
   files: it is used in place, never copied) or upload a file (copied
   into `uploads/`). Once a video is active you can also **import clip
   ranges from a notes file** via "Clips (.txt)": lines like
   `14:47 - 15:22 Cute` (also `1:02:03`-style times) each become a clip;
   `# <video name>` header lines split the file into per-VOD sections,
   and only the section whose name matches the active video is imported.
2. **Pick a range** - scrub with the timeline, the arrow keys, or click
   around the player, then press `I` (in) and `O` (out). Space toggles
   playback; `Shift` + arrow seeks one frame.
3. **Crop (optional)** - click and drag a rectangle over the video (a
   plain click plants a small crop at that point). You can move it,
   resize it from any of the 8 handles, and lock the aspect ratio
   (16:9, 1:1, source). A live preview shows the exact frame that will
   be exported. Clicking the video never starts playback - use the
   Play button or `space`.
4. **Tune the export** - per clip: note, formats (mp4, gif, both), audio
   on/off, frame rate (25/30/60), MP4 quality (matched to the source by
   default, or a manual bitrate), and for GIFs a size cap (10/25/48 MB)
   plus a maximum edge length (256-1024 px).
5. **"Add clip"** commits the current settings as a clip; you can queue
   several clips from one video and export them all at once.
6. **Export** - jobs run one after another (GPU encoding keeps them fast,
   but only one runs at a time). When a job finishes, download links for
   the MP4 and GIF appear in the EXPORTS panel. Files are also written to
   `out/<video-id>/` on disk.

Keyboard: `space` play/pause, `I`/`O` in/out, `left`/`right` seek,
`shift` + `left`/`right` = one frame.

## Limitations

- One export job at a time (jobs queue in order).
- Exports are always re-encoded (no stream-copy), so even "source"
  quality takes a moment; NVENC makes this fast on supported GPUs.
- Uploaded files are copied into `uploads/`; for very large files prefer
  the local-path option.
- The app assumes it runs on the same machine as the videos (it cannot
  reach paths on other hosts).
- GIFs are built in three stages (cut, palette, encode) and shrink
  automatically (resolution, then frame rate) until they fit the size cap;
  if even the lowest rung exceeds the cap the job fails with an error.
- Session data (loaded videos, clip lists, job history) lives in
  `.data/`; running jobs are not resumable after a server restart.
- The web UI needs a browser with `fetch` streaming for uploads; it is
  tested in Chromium.

## Getting help

- Check the browser console and the terminal running the dev server for
  errors.
- `bun test` runs the unit test suite; `bunx tsc --noEmit` typechecks.
- Job errors and warnings are shown inline in the EXPORTS panel (e.g. a
  GIF that could not be shrunk to the cap).
- File issues to the repo's issue tracker.
