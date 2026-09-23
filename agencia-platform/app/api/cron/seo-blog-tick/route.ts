import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { cronAuthOk } from "@/lib/cron-auth";
import { acquireCronLease, releaseCronLease } from "@/lib/cron/distributed-lease";
import { runSeoBlogTick } from "@/lib/seo-blog/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Disparador externo opcional (Make/GitHub Actions). El planificador interno ya lo ejecuta cada 2 min. */
export async function GET(req: NextRequest) {
  if (!cronAuthOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const owner = randomUUID();
  if (!(await acquireCronLease("in-app/seo-blog", owner, 5 * 60 * 1000))) {
    return NextResponse.json({ ok: true, skipped: "locked" });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runSeoBlogTick(170_000)) });
  } finally {
    await releaseCronLease("in-app/seo-blog", owner).catch(() => null);
  }
}
