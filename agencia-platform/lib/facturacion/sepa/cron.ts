/**
 * Tick de cron de remesas SEPA (idempotente), por workspace:
 *   - Caduca (EXPIRED) las solicitudes pendientes cuyo enlace superó las 24 h.
 *   - Si SEPA_AUTO_SCAN=true, detecta candidatas y crea solicitudes (+email).
 *     Por defecto NO auto-crea: el admin lo hace desde el botón "Buscar
 *     candidatas" para controlar el envío de emails.
 */
import { prisma } from "@/lib/db/prisma";
import { approveRequestAutomatically, expireStaleRequests, createRequestsForCandidates } from "./remittance";
import { reclaimExpiredLeases } from "./agent";
import { syncApprovedHoldedInvoices } from "./holded-auto-sync";
import { madridBusinessDayWindow } from "./recency";

export async function runSepaCronAllWorkspaces(): Promise<any[]> {
  const workspaces = await prisma.workspace.findMany({ select: { id: true } });
  // Piloto automático por defecto. Las variables a `false` quedan como
  // interruptores de emergencia; la firma bancaria sigue siendo humana.
  const autoScan = process.env.SEPA_AUTO_SCAN !== "false";
  const autoApprove = process.env.SEPA_AUTO_APPROVE !== "false";
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
        // El cron solo notifica facturas emitidas hoy (fecha fiscal real),
        // aunque una sincronización haya importado documentos históricos.
        // Incluye ayer como recuperación ante una caída o una factura emitida
        // cerca de medianoche; el límite superior excluye fechas futuras.
        const importedIds = r.holded?.createdInvoiceIds ?? [];
        const window = madridBusinessDayWindow(new Date(), 1);
        r.scan = await createRequestsForCandidates(ws.id, null, {
          max: 50,
          issuedAfter: window.start,
          issuedBefore: window.end,
          // Si este tick importó facturas, procesa exactamente esas y no un
          // histórico basado en la fecha fiscal.
          ...(importedIds.length ? { invoiceIds: importedIds } : {})
        });
        if (autoApprove && importedIds.length) {
          r.autoApproved = 0;
          for (const requestId of r.scan.requestIds) {
            if (await approveRequestAutomatically(ws.id, requestId)) r.autoApproved++;
          }
        }
      } catch (e: any) {
        r.scanError = String(e?.message ?? e);
      }
    }
    report.push(r);
  }
  return report;
}
