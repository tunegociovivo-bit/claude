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
import { logError } from "@/lib/monitoring/error-log";
import { processSearchBatch } from "@/lib/leads/search-manager";
import { processQueueTick } from "@/lib/leads/send-queue";
import { processSequencesTick } from "@/lib/leads/sequences";
import { processBroadcastTick } from "@/lib/leads/broadcast";
import { processAutoFollowupTick } from "@/lib/leads/auto-followup";
import { processExecOutreachTick } from "@/lib/leads/exec-outreach";

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
      logError("leads-cron:search", e, ws.id);
    }

    // 2. Tick de la cola de envío.
    try {
      wsReport.queue = await processQueueTick(ws.id);
    } catch (e: any) {
      wsReport.queueError = e?.message ?? String(e);
      logError("leads-cron:queue", e, ws.id);
    }

    // 3. Avanzar secuencias activas.
    try {
      wsReport.sequences = await processSequencesTick({ workspaceId: ws.id, batchSize: 20 });
    } catch (e: any) {
      wsReport.sequencesError = e?.message ?? String(e);
    }

    // 4. Tick de difusión segmentada (1 destinatario, mismo anti-baneo).
    try {
      wsReport.broadcast = await processBroadcastTick(ws.id);
    } catch (e: any) {
      wsReport.broadcastError = e?.message ?? String(e);
    }

    // 5. Auto-piloto de seguimiento (1 nudge IA a un lead caliente en silencio).
    try {
      wsReport.autoFollowup = await processAutoFollowupTick(ws.id);
    } catch (e: any) {
      wsReport.autoFollowupError = e?.message ?? String(e);
    }

    // 6. Secuencia multicanal a directivos (1 paso por tick).
    try {
      wsReport.execOutreach = await processExecOutreachTick(ws.id);
    } catch (e: any) {
      wsReport.execOutreachError = e?.message ?? String(e);
    }

    // 7. Salud de los proxies (throttleado a 15 min): verifica cada proxy
    //    configurado y guarda su estado para badges/avisos en el panel.
    try {
      const { checkAllProxiesForWorkspace } = await import("./proxy");
      await checkAllProxiesForWorkspace(ws.id);
    } catch (e: any) {
      wsReport.proxyCheckError = e?.message ?? String(e);
    }

    report.push(wsReport);
  }

  // Calentamiento por conversación entre los propios teléfonos en warm-up
  // (opt-in, horario diurno, volumen bajo). Itera workspaces por dentro.
  try {
    const { runWarmupConversations } = await import("./warmup-chat");
    await runWarmupConversations();
  } catch (e) {
    console.warn("[leads-cron] warmup-chat:", (e as Error).message);
  }

  return report;
}
