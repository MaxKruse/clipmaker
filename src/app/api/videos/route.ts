import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { probeVideo } from "@/lib/ffmpeg";
import { UPLOADS_DIR, store } from "@/lib/store";
import { newId, type VideoInfo } from "@/lib/types";

// Safety valve only; real VODs are loaded by path.
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024 * 1024;

async function registerPath(abs: string): Promise<VideoInfo> {
  if (!fs.existsSync(abs)) throw new Error("file not found");
  const info = await probeVideo(abs);
  if (!info.width) throw new Error("no video stream found");
  const v: VideoInfo = {
    id: newId(),
    name: path.basename(abs),
    path: abs,
    uploaded: false,
    ...info,
  };
  store.addVideo(v);
  return v;
}

export async function POST(req: NextRequest) {
  const ctype = req.headers.get("content-type") ?? "";
  try {
    if (ctype.startsWith("application/json")) {
      const body = (await req.json()) as { path?: string };
      const p = body.path?.trim();
      if (!p) return NextResponse.json({ error: "missing path" }, { status: 400 });
      const v = await registerPath(path.resolve(p));
      return NextResponse.json({ id: v.id, video: v });
    }

    // Raw upload: stream the body straight to disk (no multipart, no memory buffer).
    const rawName = req.headers.get("x-filename") ?? "video.mp4";
    const name = decodeURIComponent(rawName).replace(/[\\/:*?"<>|]/g, " ").trim() || "video.mp4";
    const id = newId();
    const dir = path.join(UPLOADS_DIR, id);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, name);
    const ws = fs.createWriteStream(dest);
    const reader = (req.body as ReadableStream<Uint8Array>).getReader();
    let written = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        written += value.length;
        if (written > MAX_UPLOAD_BYTES) throw new Error("upload too large");
        if (!ws.write(Buffer.from(value))) await once(ws, "drain");
      }
      await once(ws, "finish");
    } catch (e) {
      ws.destroy();
      fs.rmSync(dir, { recursive: true, force: true });
      return NextResponse.json(
        { error: `upload failed: ${e instanceof Error ? e.message : e}` },
        { status: 400 },
      );
    }
    let v: VideoInfo;
    try {
      const info = await probeVideo(dest);
      if (!info.width) throw new Error("no video stream found");
      v = { id, name, path: dest, uploaded: true, ...info };
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true });
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
    }
    store.addVideo(v);
    return NextResponse.json({ id: v.id, video: v });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json([...store.videos.values()]);
}
