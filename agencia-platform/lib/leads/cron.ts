/**
 * Tick del cron de NV Leads Pro, reutilizable desde:
 *   - el endpoint /api/v1/internal/leads-cron (cron externo)
 *   - el planificador interno (in-app-scheduler), que es lo que lo dispara
 *     de verdad en Railway cada minuto.
 *
 * Por cada workspace: procesa 1 batch de la búsqueda pendiente más antigua,
 * 1 tick de la cola de envío de WhatsApp y avanza las secuencias activas.
 * El espaciado y los topes anti-baneo viven en send-queue.ts.
 */

import { prisma } from "@/lib/db/prisma";
import { processSearchBatch } from "@/lib/leads/search-manager";
import { processQueueTick } from "@/lib/leads/send-queue";
import { processSequencesTick } from "@/lib/leads/sequences";

export async function runLeadsCronAllWorkspaces(): Promise<any[]> {
  const workspaces = await prisma.workspace.findMany({ select: { id: true } });
  const report: any[] = [];

  for (const ws of workspaces) {
    const wsReport: any = { workspaceId: ws.id };

    // 1. Procesar 1 batch de la búsqueda más antigua pendiente (si hay).
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

    // 2. Tick de la cola de envío.
    try {
      wsReport.queue = await processQueueTick(ws.id);
    } catch (e: any) {
      wsReport.queueError = e?.message ?? String(e);
    }

    // 3. Avanzar secuencias activas.
    try {
      wsReport.sequences = await processSequencesTick({ workspaceId: ws.id, batchSize: 20 });
    } catch (e: any) {
      wsReport.sequencesError = e?.message ?? String(e);
    }

    report.push(wsReport);
  }

  return report;
}
