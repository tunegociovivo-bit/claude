import { prisma } from "@/lib/db/prisma";
import { evaluateCandidacy, NEGOCIO_VIVO_ISSUER_NAME } from "./candidates";
import { createRequestsForCandidates } from "./remittance";
import { syncApprovedHoldedInvoices } from "./holded-auto-sync";

export async function syncRecentHoldedApprovals(workspaceId: string) {
  const holded = await syncApprovedHoldedInvoices(workspaceId);
  const approvals = holded.createdInvoiceIds.length
      ? await createRequestsForCandidates(workspaceId, null, {
        max: 50,
        // Solo estos IDs recién importados y, por la defensa central de
        // createRequestsForCandidates, solo con fecha fiscal de hoy.
        invoiceIds: holded.createdInvoiceIds
      })
    : { examined: 0, eligible: 0, created: 0, skipped: 0, requestIds: [] };
  return { holded, approvals };
}

export async function recoverRecentSepaApprovals(workspaceId: string, invoiceNumbers: string[]) {
  const importedAfter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const invoices = await prisma.invoice.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      issuer: { name: NEGOCIO_VIVO_ISSUER_NAME, deletedAt: null },
      createdAt: { gte: importedAfter },
      number: { in: invoiceNumbers }
    },
    select: { id: true }
  });
  return createRequestsForCandidates(workspaceId, null, {
    max: 50,
    importedAfter,
    invoiceIds: invoices.map((invoice) => invoice.id)
  });
}

export async function getRecentSepaDiagnostics(workspaceId: string, take = 50) {
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const excluded = new Set<string>(
    ((((workspace?.settings as any)?.facturacion?.sepaExcludedInvoiceNumbers ?? []) as string[])
      .map((number) => number.trim().toLowerCase()))
  );
  const invoices = await prisma.invoice.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      issuer: { name: NEGOCIO_VIVO_ISSUER_NAME, deletedAt: null },
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(take, 1), 100),
    select: {
      id: true, number: true, type: true, status: true, totalCents: true, paidCents: true,
      paidAt: true, issueDate: true, createdAt: true, clientId: true,
      client: { select: { name: true, sepaEnabled: true, sepaMandateActive: true, sepaSantanderTemplate: true } }
    }
  });
  const requests = invoices.length ? await prisma.sepaRemittanceRequest.findMany({
    where: { workspaceId, invoiceId: { in: invoices.map((invoice) => invoice.id) } },
    select: {
      invoiceId: true, status: true, archivedAt: true, approvalNotifiedAt: true, lastError: true,
      events: { orderBy: { createdAt: "desc" }, take: 1, select: { note: true, error: true, createdAt: true } }
    }
  }) : [];
  const requestByInvoice = new Map(requests.map((request) => [request.invoiceId, request]));

  return invoices.map((invoice) => {
    const request = requestByInvoice.get(invoice.id);
    const candidacy = evaluateCandidacy({
      issuerName: NEGOCIO_VIVO_ISSUER_NAME,
      status: invoice.status,
      type: invoice.type,
      number: invoice.number,
      totalCents: invoice.totalCents,
      paidCents: invoice.paidCents,
      paidAt: invoice.paidAt,
      clientId: invoice.clientId,
      clientSepaEnabled: invoice.client?.sepaEnabled ?? false,
      hasExistingRequest: Boolean(request && !request.archivedAt),
      manuallyExcluded: excluded.has((invoice.number ?? "").trim().toLowerCase())
    });
    return {
      invoiceNumber: invoice.number,
      clientName: invoice.client?.name ?? "",
      amountCents: invoice.totalCents,
      status: invoice.status,
      type: invoice.type,
      issueDate: invoice.issueDate,
      importedAt: invoice.createdAt,
      sepaEnabled: invoice.client?.sepaEnabled ?? false,
      mandateActive: invoice.client?.sepaMandateActive ?? false,
      santanderTemplateConfigured: Boolean(invoice.client?.sepaSantanderTemplate),
      eligible: candidacy.eligible,
      reasons: candidacy.reasons,
      request: request ? {
        status: request.status,
        archived: Boolean(request.archivedAt),
        approvalNotifiedAt: request.approvalNotifiedAt,
        lastError: request.lastError,
        latestEvent: request.events[0] ?? null
      } : null
    };
  });
}
