import { NextRequest, NextResponse } from "next/server";
import { toDefaults } from "@/lib/clips";
import { store } from "@/lib/store";

/**
 * New-clip defaults: the export options fresh and imported clips are
 * created with. Existing clips always keep their own settings.
 */
export async function GET() {
  return NextResponse.json(store.defaults);
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as unknown;
    const defaults = toDefaults(body);
    store.setDefaults(defaults);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
