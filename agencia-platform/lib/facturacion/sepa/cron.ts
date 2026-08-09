/**
 * Tick de cron de remesas SEPA (idempotente), por workspace:
 *   - Caduca (EXPIRED) las solicitudes pendientes cuyo enlace superó las 24 h.
 *   - Si SEPA_AUTO_SCAN=true, detecta candidatas y crea solicitudes (+email).
 *     Por defecto NO auto-crea: el admin lo hace desde el botón "Buscar
 *     candidatas" para controlar el envío de emails.
 */
import { prisma } from "@/lib/db/prisma";
import { expireStaleRequests, createRequestsForCandidates } from "./remittance";
import { reclaimExpiredLeases } from "./agent";
import { syncApprovedHoldedInvoices } from "./holded-auto-sync";

export async function runSepaCronAllWorkspaces(): Promise<any[]> {
  const workspaces = await prisma.workspace.findMany({ select: { id: true } });
  // Opt-in de producción: evita activar emails para otros workspaces o para
  // candidatas históricas durante un despliegue.
  const autoScan = process.env.SEPA_AUTO_SCAN === "true";
  const report: any[] = [];
  for (const ws of workspaces) {
    const r: any = { workspaceId: ws.id };
    try {
      r.holded = await syncApprovedHoldedInvoices(ws.id);
    } catch (e: any) {
      // Un fallo de Holded no impide caducar enlaces ni recuperar leases.
      r.holdedError = String(e?.message ?? e);
    }
    try {
      r.expired = await expireStaleRequests(ws.id);
    } catch (e: any) {
      r.expireError = String(e?.message ?? e);
    }
    try {
      r.leases = await reclaimExpiredLeases(ws.id); // re-encola trabajos con lease caducado
    } catch (e: any) {
      r.leaseError = String(e?.message ?? e);
    }
    if (autoScan) {
      try {
        // El cron solo notifica facturas recién sincronizadas. El escaneo
        // manual del HUB conserva la capacidad de revisar candidatas antiguas.
        r.scan = await createRequestsForCandidates(ws.id, null, {
          max: 50,
          createdAfter: new Date(Date.now() - 10 * 60 * 1000)
        });
      } catch (e: any) {
        r.scanError = String(e?.message ?? e);
      }
    }
    report.push(r);
  }
  return report;
}
