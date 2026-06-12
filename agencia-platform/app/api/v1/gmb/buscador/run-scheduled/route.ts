/**
 * POST /api/v1/gmb/buscador/run-scheduled  (CRON, protegido por secreto)
 *
 * Ejecuta las búsquedas programadas que toquen (daily/weekly/monthly) en todos
 * los workspaces, detecta reclamables y avisa por email. Pensado para un cron
 * de Railway que llame con la cabecera: x-cron-secret: $CRON_SECRET
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { runGmbSearch } from "@/lib/integrations/gmb-buscador";
import { cronAuthOk } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const INTERVAL_MS: Record<string, number> = {
  daily: 86400_000,
  weekly: 604800_000,
  monthly: 2592000_000
};

export async function POST(req: NextRequest) {
  if (!cronAuthOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const searches = await prisma.gmbSearch.findMany({ where: { schedule: { not: "none" } } });
  const now = Date.now();
  let ran = 0;
  const summary: any[] = [];
  for (const s of searches) {
    const interval = INTERVAL_MS[s.schedule] ?? 0;
    if (!interval) continue;
    const last = s.lastRun ? s.lastRun.getTime() : 0;
    if (now - last < interval) continue;
    try {
      const r = await runGmbSearch({ workspaceId: s.workspaceId, search: s, verify: true });
      ran++;
      summary.push({ id: s.id, name: s.name, ...r });
    } catch (e: any) {
      summary.push({ id: s.id, name: s.name, error: String(e?.message ?? e) });
    }
  }
  return NextResponse.json({ ok: true, ran, summary });
}
