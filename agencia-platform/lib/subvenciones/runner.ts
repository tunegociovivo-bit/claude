import { prisma } from "@/lib/db/prisma";
import { ingestConvocatorias } from "./bdns";
import { runAgencyOpportunityAlerts, runSubvencionAlertas, runSubvencionDigest } from "./alertas";
import { updateSubvencionHealth } from "./operations";
import { ingestPlacspMarketing } from "./placsp";
import { ingestEuFunding } from "./eu-funding";

let running: Promise<any> | null = null;
let completedDate = "";

export async function runSubvencionesDaily(trigger: "cron" | "manual" = "cron", force = false) {
  const today = new Date().toISOString().slice(0, 10);
  if (!force && completedDate === today) return { ok: true, skipped: true, reason: "already_ran_today" };
  if (running) return running;
  running = (async () => {
    const startedAt = new Date().toISOString();
    try {
      const ingest = await ingestConvocatorias();
      const placsp = await ingestPlacspMarketing().catch((error) => ({ fetched: 0, relevant: 0, upserted: 0, error: error instanceof Error ? error.message : "Error PLACSP" }));
      const euFunding = await ingestEuFunding().catch((error) => ({ fetched: 0, upserted: 0, error: error instanceof Error ? error.message : "Error EU Funding" }));
      const closing = await runSubvencionAlertas();
      const opportunities = await runAgencyOpportunityAlerts();
      const digest = await runSubvencionDigest();
      completedDate = today;
      const workspaces = await prisma.workspace.findMany({ select: { id: true } });
      await Promise.all(workspaces.map((w) => updateSubvencionHealth(w.id, {
        lastRunAt: startedAt,
        lastIngestAt: new Date().toISOString(),
        lastError: ["error" in placsp ? `PLACSP: ${placsp.error}` : "", "error" in euFunding ? `EU: ${euFunding.error}` : ""].filter(Boolean).join(" · ").slice(0, 500) || null,
        ingested: ingest.upserted + ingest.curadas + placsp.upserted + euFunding.upserted,
        notifications: closing.enviados + opportunities.enviados + digest.enviados,
        trigger
      }).catch(() => {})));
      return { ok: true, ingest, placsp, euFunding, closing, opportunities, digest };
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "Error desconocido";
      const workspaces = await prisma.workspace.findMany({ select: { id: true } });
      await Promise.all(workspaces.map((w) => updateSubvencionHealth(w.id, {
        lastRunAt: startedAt, lastError: message, trigger
      }).catch(() => {})));
      throw error;
    } finally {
      running = null;
    }
  })();
  return running;
}
