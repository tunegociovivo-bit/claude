import { NextRequest, NextResponse } from "next/server";
import { cronAuthOk } from "@/lib/cron-auth";
import { publishDueEditorialPublications } from "@/lib/editorial/meta-publishing";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!cronAuthOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const limit = Math.max(1, Math.min(100, Number(new URL(req.url).searchParams.get("limit") ?? 50)));
  const out = await publishDueEditorialPublications({ limit });
  return NextResponse.json({ ok: true, ...out });
}
