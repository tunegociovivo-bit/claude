import { NextRequest, NextResponse } from "next/server";
import { cronAuthOk } from "@/lib/cron-auth";
import { runProspectingEngine } from "@/lib/leads/prospecting-engine";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!cronAuthOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await runProspectingEngine()) });
}
