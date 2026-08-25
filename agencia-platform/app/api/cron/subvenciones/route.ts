import { NextRequest, NextResponse } from "next/server";
import { cronAuthOk } from "@/lib/cron-auth";
import { runSubvencionesDaily } from "@/lib/subvenciones/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!cronAuthOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runSubvencionesDaily("cron"));
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "unknown" }, { status: 500 });
  }
}
