/**
 * Tick de cron de remesas SEPA (idempotente), por workspace:
 *   - Caduca (EXPIRED) las solicitudes pendientes cuyo enlace superó las 24 h.
 *   - Si SEPA_AUTO_SCAN=true, detecta candidatas y crea solicitudes (+email).
 *     Por defecto NO auto-crea: el admin lo hace desde el botón "Buscar
 *     candidatas" para controlar el envío de emails.
 */
import { prisma } from "@/lib/db/prisma";
import { expireStaleRequests, createRequestsForCandidates } from "./remittance";
import { requiresExplicitApproval } from "./approval-policy";
import { reclaimExpiredLeases, setAgentClaimingEnabled } from "./agent";
import { syncApprovedHoldedInvoices } from "./holded-auto-sync";
import { madridBusinessDayWindow } from "./recency";

export async function runSepaCronAllWorkspaces(): Promise<any[]> {
  const workspaces = await prisma.workspace.findMany({ select: { id: true } });
  // Piloto automático por defecto. Las variables a `false` quedan como
  // interruptores de emergencia; la firma bancaria sigue siendo humana.
  const autoScan = process.env.SEPA_AUTO_SCAN !== "false";
  const report: any[] = [];
  for (const ws of workspaces) {
    const r: any = { workspaceId: ws.id };
    // Limpieza acotada del incidente del 12/08/2026: una ejecución importó y
    // encoló huecos históricos. Se conserva la auditoría y solo se archivan
    // esas referencias exactas creadas durante la ventana del incidente.
    const incidentNumbers = ["FAC-002933", "FAC-002936", "FAC-002957", "FAC-002967", "FAC-002968", "FAC-002969", "FAC-002970", "FAC-002971", "FAC-002973", "FAC-002979", "FAC-002985", "FAC-002986", "FAC-002989"];
    const incidentRequests = await prisma.sepaRemittanceRequest.findMany({
      where: {
        workspaceId: ws.id,
        invoiceNumber: { in: incidentNumbers },
        createdAt: { gte: new Date("2026-08-12T06:20:00.000Z"), lte: new Date("2026-08-12T06:40:00.000Z") },
        archivedAt: null
      },
      select: { id: true }
    });
    if (incidentRequests.length) {
      const ids = incidentRequests.map((item) => item.id);
      // Parada de emergencia antes de cancelar trabajos: también impide que un
      // agente con lease en vuelo marque otra preparación como completada.
      await setAgentClaimingEnabled(ws.id, false);
      await prisma.$transaction([
        prisma.remittanceJob.updateMany({
          where: { workspaceId: ws.id, remittanceRequestId: { in: ids }, status: { in: ["PENDING", "CLAIMED", "RUNNING", "NEEDS_USER", "FAILED"] } },
          data: { status: "CANCELLED", lastError: "Archivado: solicitud histórica creada por el incidente del 12/08/2026" }
        }),
        prisma.sepaRemittanceRequest.updateMany({
          where: { id: { in: ids }, workspaceId: ws.id, archivedAt: null },
          data: { archivedAt: new Date(), tokenUsedAt: new Date() }
        })
      ]);
      r.incidentArchived = ids.length;
    }
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
        // A newly imported invoice may create and email an approval request,
        // but only an explicit administrator decision may consume its token.
        r.requiresExplicitApproval = requiresExplicitApproval({
          source: "HOLDED",
          importedNow: importedIds.length > 0,
          legacyAutoApproveFlag: process.env.SEPA_AUTO_APPROVE === "true"
        });
      } catch (e: any) {
        r.scanError = String(e?.message ?? e);
      }
    }
    report.push(r);
  }
  return report;
}
