/**
 * Tick de cron de remesas SEPA (idempotente), por workspace:
 *   - Caduca (EXPIRED) las solicitudes pendientes cuyo enlace superó las 24 h.
 *   - Si SEPA_AUTO_SCAN=true, detecta candidatas y crea solicitudes (+email).
 *     Por defecto NO auto-crea: el admin lo hace desde el botón "Buscar
 *     candidatas" para controlar el envío de emails.
 */
import { prisma } from "@/lib/db/prisma";
import { expireStaleRequests, createRequestsForCandidates } from "./remittance";

export async function runSepaCronAllWorkspaces(): Promise<any[]> {
  const workspaces = await prisma.workspace.findMany({ select: { id: true } });
  const autoScan = process.env.SEPA_AUTO_SCAN === "true";
  const report: any[] = [];
  for (const ws of workspaces) {
    const r: any = { workspaceId: ws.id };
    try {
      r.expired = await expireStaleRequests(ws.id);
    } catch (e: any) {
      r.expireError = String(e?.message ?? e);
    }
    if (autoScan) {
      try {
        r.scan = await createRequestsForCandidates(ws.id, null, { max: 50 });
      } catch (e: any) {
        r.scanError = String(e?.message ?? e);
      }
    }
    report.push(r);
  }
  return report;
}
