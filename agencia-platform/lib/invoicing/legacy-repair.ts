import { prisma } from "@/lib/db/prisma";
import { assignInvoiceNumber } from "./numbering";
import { defaultSeriesForType } from "./core";
import { RIXUS_LOGO_DATA_URI } from "./rixus-logo";

const MIGRATION_ACTION = "invoice.legacy_number_branding_repair.v1";

/**
 * Reparación puntual solicitada para documentos creados por la versión que
 * permitía SENT sin número. Queda auditada, no reenvía correos y no vuelve a
 * ejecutarse en el workspace.
 */
export async function repairLegacyInvoiceDocuments(workspaceId: string, actorId: string): Promise<void> {
  const done = await prisma.auditLog.findFirst({ where: { workspaceId, action: MIGRATION_ACTION } });
  if (done) return;

  await prisma.$transaction(async (tx) => {
    const numberless = await tx.invoice.findMany({
      where: { workspaceId, deletedAt: null, number: null, status: { not: "DRAFT" } },
      orderBy: [{ issueDate: "asc" }, { createdAt: "asc" }]
    });
    for (const invoice of numberless) {
      const series = invoice.series || defaultSeriesForType(invoice.type as any);
      const number = await assignInvoiceNumber(workspaceId, series, invoice.issueDate.getUTCFullYear(), tx);
      await tx.invoice.update({ where: { id: invoice.id }, data: { number } });
      await tx.auditLog.create({
        data: {
          workspaceId,
          actorId,
          action: "invoice.legacy_number_repaired",
          targetType: "Invoice",
          targetId: invoice.id,
          meta: { before: { number: null, status: invoice.status }, after: { number, status: invoice.status }, resent: false }
        }
      });
    }

    const rixusIssuers = await tx.invoiceIssuer.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        OR: [{ taxId: "37-2141153" }, { name: { contains: "Rixus Solutions", mode: "insensitive" } }]
      },
      select: { id: true }
    });
    const issued = await tx.invoice.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        issuerId: { in: rixusIssuers.map((issuer) => issuer.id) },
        status: { in: ["ISSUED", "SENT", "PAID", "ACCEPTED"] }
      },
      select: { id: true, issuerSnapshot: true }
    });
    for (const invoice of issued) {
      const snapshot = (invoice.issuerSnapshot ?? {}) as Record<string, unknown>;
      if (typeof snapshot.logoUrl === "string" && snapshot.logoUrl.trim()) continue;
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { issuerSnapshot: { ...snapshot, logoUrl: RIXUS_LOGO_DATA_URI } }
      });
      await tx.auditLog.create({
        data: {
          workspaceId,
          actorId,
          action: "invoice.legacy_branding_repaired",
          targetType: "Invoice",
          targetId: invoice.id,
          meta: { field: "issuerSnapshot.logoUrl", reason: "Logo RIXUS ausente en documento legado" }
        }
      });
    }

    await tx.auditLog.create({
      data: {
        workspaceId,
        actorId,
        action: MIGRATION_ACTION,
        targetType: "Workspace",
        targetId: workspaceId,
        meta: { numbered: numberless.length, branded: issued.length, resent: false }
      }
    });
  }, { isolationLevel: "Serializable", timeout: 30_000 });
}
