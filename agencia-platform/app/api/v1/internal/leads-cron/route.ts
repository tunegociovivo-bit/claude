/**
 * Cron interno de NV Leads Pro. Dispara por workspace:
 *   - Process search batches pendientes
 *   - Process send queue (1 tick por workspace)
 *   - Process sequences
 *
 * Protegido por Bearer INTERNAL_CRON_TOKEN. Pensado para llamarse cada
 * minuto desde GitHub Actions o un cron de Railway.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { processSearchBatch } from "@/lib/leads/search-manager";
import { processQueueTick } from "@/lib/leads/send-queue";
import { processSequencesTick } from "@/lib/leads/sequences";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const expected = process.env.INTERNAL_CRON_TOKEN ?? "";
  if (!expected || token !== expected) {
    return NextResponse.json({ error: { code: "bad_token", message: "Token inválido" } }, { status: 401 });
  }

  const workspaces = await prisma.workspace.findMany({ select: { id: true } });
  const report: any[] = [];

  for (const ws of workspaces) {
    const wsReport: any = { workspaceId: ws.id };
    // 1. Procesar 1 batch de la búsqueda más antigua pendiente (si hay)
    try {
      const search = await prisma.leadSearch.findFirst({
        where: { workspaceId: ws.id, status: { in: ["PENDING", "RUNNING"] } },
        orderBy: { createdAt: "asc" }
      });
      if (search) {
        const r = await processSearchBatch({ workspaceId: ws.id, searchId: search.id, batchSize: 5 });
        wsReport.search = { searchId: search.id, ...r };
      }
    } catch (e: any) {
      wsReport.searchError = e?.message ?? String(e);
    }
    // 2. Tick de la cola de envío
    try {
      const r = await processQueueTick(ws.id);
      wsReport.queue = r;
    } catch (e: any) {
      wsReport.queueError = e?.message ?? String(e);
    }
    // 3. Avanzar secuencias activas
    try {
      const r = await processSequencesTick({ workspaceId: ws.id, batchSize: 20 });
      wsReport.sequences = r;
    } catch (e: any) {
      wsReport.sequencesError = e?.message ?? String(e);
    }
    report.push(wsReport);
  }

  return NextResponse.json({ ok: true, workspaces: report });
}
