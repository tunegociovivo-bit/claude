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
import { processQueueTick, prioritizeQueue } from "@/lib/leads/send-queue";

// Throttle del reordenador automático por workspace: solo se re-prioriza como
// mucho una vez cada 10 min, para no reescribir cientos de scheduledAt cada
// minuto. Se resetea al redesplegar (aceptable). El disparador es que el tick
// no encuentre NINGÚN elegible vencido ("no_eligible_due").
const _lastPrioritizeAt = new Map<string, number>();
const PRIORITIZE_THROTTLE_MS = 10 * 60 * 1000;
// Bandeja de alertas de empleo (IMAP): se revisa como mucho cada 30 min por
// workspace (las alertas llegan a lo sumo cada pocas horas). Se resetea al
// redesplegar (aceptable).
const _lastJobsInboxAt = new Map<string, number>();
const JOBS_INBOX_THROTTLE_MS = 30 * 60 * 1000;
import { processSequencesTick } from "@/lib/leads/sequences";
import { processBroadcastTick } from "@/lib/leads/broadcast";
import { processAutoFollowupTick } from "@/lib/leads/auto-followup";
import { processExecOutreachTick } from "@/lib/leads/exec-outreach";
import { ingestJobsInbox } from "@/lib/leads/search-manager";

export async function runLeadsCronAllWorkspaces(): Promise<any[]> {
  const workspaces = await prisma.workspace.findMany({ select: { id: true } });
  const report: any[] = [];

  for (const ws of workspaces) {
    const wsReport: any = { workspaceId: ws.id };

    // 1. Procesar 1 batch de la búsqueda más antigua pendiente (si hay).
    try {
      // Incluye PAUSING/CANCELLING: si el usuario pidió pausar/cancelar y no había lote en
      // vuelo, processSearchBatch los finaliza (PAUSED/CANCELLED) en este tick. PAUSED y
      // CANCELLED quedan FUERA → el cron no reanuda una búsqueda pausada/cancelada.
      const search = await prisma.leadSearch.findFirst({
        where: { workspaceId: ws.id, status: { in: ["PENDING", "RUNNING", "PAUSING", "CANCELLING"] } },
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
      // REORDENADOR AUTOMÁTICO: si no había ningún elegible vencido (toda la
      // cola vencida está en cool-down), re-priorizamos para adelantar los leads
      // nunca-contactados y que la cola drene con volumen. Throttleado a 10 min.
      if (wsReport.queue?.error === "no_eligible_due") {
        const last = _lastPrioritizeAt.get(ws.id) ?? 0;
        if (Date.now() - last > PRIORITIZE_THROTTLE_MS) {
          _lastPrioritizeAt.set(ws.id, Date.now());
          wsReport.prioritized = await prioritizeQueue(ws.id);
        }
      }
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

    // 6b. Bandeja de alertas de empleo (IMAP): lee alertas nuevas y crea leads.
    //     Throttleado a 30 min y solo si el workspace la tiene activada.
    try {
      const wsRow = await prisma.workspace.findUnique({ where: { id: ws.id }, select: { settings: true } });
      const enabled = !!(wsRow?.settings as any)?.leads?.jobsInboxEnabled;
      const last = _lastJobsInboxAt.get(ws.id) ?? 0;
      if (enabled && Date.now() - last > JOBS_INBOX_THROTTLE_MS) {
        _lastJobsInboxAt.set(ws.id, Date.now());
        wsReport.jobsInbox = await ingestJobsInbox(ws.id);
      }
    } catch (e: any) {
      wsReport.jobsInboxError = e?.message ?? String(e);
    }

    // 6c. Cola de identificación de titulares de franquicia (async): investiga hasta 2
    //     leads brand_locations encolados por tick, en segundo plano (nunca en la request).
    try {
      const { processFranchiseOwnerQueue } = await import("./franchise-owner-queue");
      const fo = await processFranchiseOwnerQueue(prisma, ws.id, { max: 2 });
      wsReport.franchiseOwners = fo;
      if (fo.picked > 0) console.info(`[leads-cron] franchise-owner ws=${ws.id} picked=${fo.picked} done=${fo.processed} error=${fo.errored}`);
    } catch (e: any) {
      wsReport.franchiseOwnersError = e?.message ?? String(e);
      console.warn(`[leads-cron] franchise-owner ws=${ws.id} FALLO: ${String(e?.name ?? "error")}`);
    }

    // 6d. Cola de CONTACTO profesional (fase 2, async): busca email/móvil publicado de hasta 2
    //     titulares identificados por tick, en segundo plano (web oficial + Hunter + Apollo).
    try {
      const { processFranchiseContactQueue } = await import("./franchise-contact-queue");
      const fc = await processFranchiseContactQueue(prisma, ws.id, { max: 2 });
      wsReport.franchiseContacts = fc;
      if (fc.picked > 0) console.info(`[leads-cron] franchise-contact ws=${ws.id} picked=${fc.picked} done=${fc.processed} error=${fc.errored}`);
    } catch (e: any) {
      wsReport.franchiseContactsError = e?.message ?? String(e);
      console.warn(`[leads-cron] franchise-contact ws=${ws.id} FALLO: ${String(e?.name ?? "error")}`);
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
