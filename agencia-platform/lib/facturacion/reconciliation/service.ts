import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { effectiveSepaCandidateDate, matchIncomingPayment, matchSepaReceipt, matchUniqueSepaSummary, persistedBankReference, requiresVerifiedSepaReceipt, retainEligiblePaymentMatch, shouldImportMovement, shouldReprocessExistingBankTransaction } from "./matching";
import { sendEmail } from "@/lib/integrations/email";
import { profileForForcedReconciliation } from "./state";
import { assignManualRemittances, assignRemittanceGroups, duplicateRemittanceRowIds, isRemittanceAggregate, remittanceCode, suggestInvoicesForMovement, UNDOABLE_CONFIDENCES } from "./remittances";

export const NEGOCIO_VIVO_RECONCILIATION_START = new Date("2026-08-09T22:00:00.000Z");

export type IncomingBankMovement = {
  externalId: string;
  bookedAt: string;
  valueAt?: string | null;
  amountCents: number;
  currency?: string;
  counterpartyName?: string | null;
  reference?: string | null;
  accountMasked?: string | null;
  remittanceNumber?: string | null;
  debtorIbanLast4?: string | null;
};

function clean(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim().slice(0, max);
  return text || null;
}

function fingerprint(workspaceId: string, movement: IncomingBankMovement): string {
  return createHash("sha256").update(JSON.stringify([workspaceId, movement.externalId, movement.bookedAt, movement.amountCents, movement.currency ?? "EUR"])).digest("hex");
}

export async function ensureReconciliationConfig(workspaceId: string) {
  const existing = await prisma.bankReconciliationConfig.findUnique({ where: { workspaceId } });
  const existingProfile = (existing?.profile as Record<string, unknown> | null) ?? {};
  const oldVersion = Number(existingProfile.schemaVersion ?? 0);
  const profile = {
    ...existingProfile,
    schemaVersion: 5,
    santanderOrigin: "https://empresas3.gruposantander.es",
    reconciliationMode: "sepa-core-receipts-and-account-expenses",
    dailyAt: "08:00",
    timeZone: "Europe/Madrid",
    storesBankCredentials: false
  };
  return prisma.bankReconciliationConfig.upsert({
    where: { workspaceId },
    create: {
      workspaceId,
      enabled: true,
      startsAt: NEGOCIO_VIVO_RECONCILIATION_START,
      provider: "SANTANDER",
      pollMinutes: 1440,
      profile
    },
    update: {
      pollMinutes: 1440,
      profile,
      ...(oldVersion < 4 ? { lastSyncAt: null } : {})
    }
  });
}

function expenseDetails(reference: string | null) {
  const text = reference ?? "Movimiento Santander";
  if (/liquidacion por emision|comision/i.test(text)) return { supplier: "Banco Santander", category: "BANCO", paymentMethod: "OTHER" };
  if (/simyo/i.test(text)) return { supplier: "Simyo", category: "SUMINISTROS", paymentMethod: "REMITTANCE" };
  if (/openai/i.test(text)) return { supplier: "OpenAI", category: "SOFTWARE", paymentMethod: "CARD" };
  if (/banahosting/i.test(text)) return { supplier: "BanaHosting", category: "SOFTWARE", paymentMethod: "CARD" };
  if (/zadarma/i.test(text)) return { supplier: "Zadarma", category: "SOFTWARE", paymentMethod: "CARD" };
  if (/twilio/i.test(text)) return { supplier: "Twilio", category: "SOFTWARE", paymentMethod: "CARD" };
  if (/piensasolutions/i.test(text)) return { supplier: "Piensa Solutions", category: "SOFTWARE", paymentMethod: "CARD" };
  if (/paypal/i.test(text)) return { supplier: "PayPal", category: "OTROS", paymentMethod: "REMITTANCE" };
  return { supplier: null, category: "OTROS", paymentMethod: "OTHER" };
}

async function repairDuplicateSepaReceipts(workspaceId: string) {
  const rows = await prisma.bankTransaction.findMany({
    where: { workspaceId, status: "UNMATCHED", reference: { contains: "Recibo" } },
    select: { id: true, reference: true }
  });
  const groups = new Map<string, Array<{ id: string; remittance: string }>>();
  for (const row of rows) {
    const receipt = row.reference?.match(/Recibo\s+([A-Z0-9]+)/i)?.[1];
    const remittance = row.reference?.match(/Remesa SEPA\s+([A-Z0-9]+)/i)?.[1];
    if (!receipt || !remittance) continue;
    const list = groups.get(receipt) ?? [];
    list.push({ id: row.id, remittance });
    groups.set(receipt, list);
  }
  const invalidIds = [...groups.values()].filter((list) => new Set(list.map((item) => item.remittance)).size > 1).flatMap((list) => list.map((item) => item.id));
  if (invalidIds.length) await prisma.bankTransaction.deleteMany({ where: { workspaceId, id: { in: invalidIds }, status: "UNMATCHED" } });
}

async function repairMisreferencedTransfers(workspaceId: string) {
  const rows = await prisma.bankTransaction.findMany({
    where: { workspaceId, status: "MATCHED", matchConfidence: "CLIENT_AMOUNT", reference: { contains: "FAC-" } },
    include: { invoice: { select: { id: true, number: true, status: true, totalCents: true, paidCents: true, paidAt: true } } }
  });
  for (const row of rows) {
    const referenced = row.reference?.match(/FAC[-\s]?\d+/i)?.[0].replace(/\s/g, "").toUpperCase();
    const linked = row.invoice?.number?.replace(/\s/g, "").toUpperCase();
    if (!referenced || !linked || referenced === linked) continue;
    await prisma.$transaction(async (tx) => {
      await tx.bankTransaction.update({ where: { id: row.id }, data: { status: "UNMATCHED", matchedInvoiceId: null, matchConfidence: null, matchedAt: null } });
      if (row.invoice?.status === "PAID" && row.invoice.paidCents === row.invoice.totalCents) {
        await tx.invoice.update({ where: { id: row.invoice.id }, data: { status: "ISSUED", paidCents: 0, paidAt: null } });
      }
    });
  }
}

function sepaReferenceSuffix(reference: string | null): string | null {
  const match = reference?.match(/Referencia:\s*([A-Z0-9 ]+)/i)?.[1]
    ?? reference?.match(/Remesa SEPA(?:\s+verificada)?\s*([A-Z0-9 ]+)/i)?.[1];
  const compact = match?.replace(/\s+/g, "").toUpperCase();
  return compact && compact.length >= 3 ? compact.slice(-3) : null;
}

function madridDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

async function repairUnmatchedExactReferences(workspaceId: string) {
  const rows = await prisma.bankTransaction.findMany({
    where: { workspaceId, status: "UNMATCHED", amountCents: { gt: 0 }, reference: { contains: "FAC-", mode: "insensitive" } },
    select: { id: true, amountCents: true, bookedAt: true, reference: true }
  });
  for (const row of rows) {
    const referenced = row.reference?.match(/FAC[-\s]?\d+/i)?.[0].replace(/\s/g, "").toUpperCase();
    if (!referenced) continue;
    const invoices = await prisma.invoice.findMany({
      where: { workspaceId, number: { equals: referenced, mode: "insensitive" }, status: "ISSUED", deletedAt: null, paidCents: 0, totalCents: row.amountCents },
      select: { id: true, totalCents: true },
      take: 2
    });
    if (invoices.length !== 1) continue;
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.bankTransaction.updateMany({
        where: { id: row.id, workspaceId, status: "UNMATCHED" },
        data: { status: "MATCHED", matchedInvoiceId: invoices[0].id, matchConfidence: "EXACT_REFERENCE", matchedAt: new Date() }
      });
      if (!claimed.count) return;
      await tx.invoice.updateMany({
        where: { id: invoices[0].id, workspaceId, status: "ISSUED", paidCents: 0 },
        data: { status: "PAID", paidCents: invoices[0].totalCents, paidAt: row.bookedAt }
      });
    });
  }
}

async function repairSyntheticSepaDuplicates(workspaceId: string) {
  const synthetic = await prisma.bankTransaction.findMany({
    where: { workspaceId, status: "MATCHED", AND: [
      { OR: [
        { reference: { contains: "Remesa SEPA verificada", mode: "insensitive" } },
        { reference: { contains: "Contabilizada", mode: "insensitive" } }
      ] },
      // Los abonos conciliados por grupo de remesas del HUB, por importe único o
      // a mano ya descartan sus duplicados (recibos) al conciliarse.
      { OR: [{ matchConfidence: null }, { matchConfidence: { notIn: [...UNDOABLE_CONFIDENCES] } }] }
    ] },
    include: { invoice: { select: { id: true, status: true, totalCents: true, paidCents: true, paidAt: true } } }
  });
  for (const row of synthetic) {
    const suffix = sepaReferenceSuffix(row.reference);
    if (!suffix) continue;
    const possibleCanonical = await prisma.bankTransaction.findMany({
      where: {
        id: { not: row.id }, workspaceId, status: "MATCHED", amountCents: row.amountCents,
        bookedAt: { gte: new Date(row.bookedAt.getTime() - 36 * 60 * 60 * 1000), lte: new Date(row.bookedAt.getTime() + 36 * 60 * 60 * 1000) }
      },
      select: { id: true, reference: true, bookedAt: true }
    });
    const canonical = possibleCanonical.find((item) => sepaReferenceSuffix(item.reference) === suffix && madridDay(item.bookedAt) === madridDay(row.bookedAt));
    if (!canonical) continue;
    await prisma.$transaction(async (tx) => {
      await tx.bankTransaction.update({
        where: { id: row.id },
        data: { status: "IGNORED", matchedInvoiceId: null, matchConfidence: null, matchedAt: null }
      });
      if (row.invoice?.status === "PAID" && row.invoice.paidCents === row.invoice.totalCents) {
        await tx.invoice.update({ where: { id: row.invoice.id }, data: { status: "ISSUED", paidCents: 0, paidAt: null } });
      }
    });
  }

  const explicitDuplicates = await prisma.bankTransaction.findMany({
    where: { workspaceId, status: "UNMATCHED", amountCents: { gt: 0 }, reference: { contains: "Factura FAC-", mode: "insensitive" } },
    select: { id: true, amountCents: true, bookedAt: true, reference: true }
  });
  for (const row of explicitDuplicates) {
    const number = row.reference?.match(/FAC[-\s]?\d+/i)?.[0].replace(/\s/g, "").toUpperCase();
    if (!number) continue;
    const invoice = await prisma.invoice.findFirst({ where: { workspaceId, number: { equals: number, mode: "insensitive" }, status: "PAID" }, select: { id: true } });
    if (!invoice) continue;
    const canonical = await prisma.bankTransaction.findFirst({
      where: {
        workspaceId, status: "MATCHED", matchedInvoiceId: invoice.id, amountCents: row.amountCents,
        bookedAt: { gte: new Date(row.bookedAt.getTime() - 12 * 60 * 60 * 1000), lte: new Date(row.bookedAt.getTime() + 12 * 60 * 60 * 1000) }
      },
      select: { id: true }
    });
    if (canonical) await prisma.bankTransaction.update({ where: { id: row.id }, data: { status: "IGNORED" } });
  }
}

async function reconcileUniqueSepaSummaries(workspaceId: string) {
  let matched = 0;
  const summaries = await prisma.bankTransaction.findMany({
    where: {
      workspaceId,
      status: "UNMATCHED",
      amountCents: { gt: 0 },
      OR: [
        { reference: { contains: "Emision Remesa Sepa", mode: "insensitive" } },
        { reference: { contains: "Remesa SEPA", mode: "insensitive" } }
      ]
    },
    select: { id: true, amountCents: true, bookedAt: true, reference: true }
  });
  for (const summary of summaries) {
    const suffix = sepaReferenceSuffix(summary.reference);
    if (suffix) {
      const sameDayMatches = await prisma.bankTransaction.findMany({
        where: {
          workspaceId, status: "MATCHED", amountCents: summary.amountCents,
          bookedAt: { gte: new Date(summary.bookedAt.getTime() - 36 * 60 * 60 * 1000), lte: new Date(summary.bookedAt.getTime() + 36 * 60 * 60 * 1000) }
        },
        select: { reference: true, bookedAt: true }
      });
      if (sameDayMatches.some((item) => sepaReferenceSuffix(item.reference) === suffix && madridDay(item.bookedAt) === madridDay(summary.bookedAt))) {
        await prisma.bankTransaction.updateMany({ where: { id: summary.id, workspaceId, status: "UNMATCHED" }, data: { status: "IGNORED" } });
        continue;
      }
    }
    const nearbyRequests = await prisma.sepaRemittanceRequest.findMany({
      where: {
        workspaceId,
        archivedAt: null,
        status: { in: ["PENDING_SIGNATURE", "SIGNED"] },
        amountCents: summary.amountCents,
        OR: [
          { chargeDate: {
            gte: new Date(summary.bookedAt.getTime() - 4 * 24 * 60 * 60 * 1000),
            lte: new Date(summary.bookedAt.getTime() + 12 * 60 * 60 * 1000)
          } },
          { chargeDate: null, createdAt: {
            gte: new Date(summary.bookedAt.getTime() - 4 * 24 * 60 * 60 * 1000),
            lte: new Date(summary.bookedAt.getTime() + 12 * 60 * 60 * 1000)
          } }
        ]
      },
      select: { invoiceId: true, amountCents: true, chargeDate: true, createdAt: true, archivedAt: true }
    });
    const outstandingInvoices = nearbyRequests.length ? await prisma.invoice.findMany({
      where: {
        workspaceId,
        id: { in: [...new Set(nearbyRequests.map((request) => request.invoiceId))] },
        status: "ISSUED",
        paidCents: 0,
        deletedAt: null
      },
      select: { id: true }
    }) : [];
    const outstandingInvoiceIds = new Set(outstandingInvoices.map((invoice) => invoice.id));
    const requestMatch = matchUniqueSepaSummary(
      { amountCents: summary.amountCents, bookedAt: summary.bookedAt },
      nearbyRequests.map((request) => ({
        ...request,
        chargeDate: effectiveSepaCandidateDate(request.chargeDate, request.createdAt),
        outstanding: outstandingInvoiceIds.has(request.invoiceId)
      }))
    );
    if (requestMatch) {
      const invoice = await prisma.invoice.findFirst({
        where: { id: requestMatch.invoiceId, workspaceId, status: "ISSUED", deletedAt: null, paidCents: 0 },
        select: { id: true, totalCents: true }
      });
      if (invoice?.totalCents === summary.amountCents) {
        await prisma.$transaction(async (tx) => {
          const claimed = await tx.bankTransaction.updateMany({
            where: { id: summary.id, workspaceId, status: "UNMATCHED" },
            data: { status: "MATCHED", matchedInvoiceId: invoice.id, matchConfidence: "SEPA_REQUEST_DATE_AMOUNT", matchedAt: new Date() }
          });
          if (!claimed.count) return;
          const invoiceClaim = await tx.invoice.updateMany({
            where: { id: invoice.id, workspaceId, status: "ISSUED", paidCents: 0 },
            data: { status: "PAID", paidCents: invoice.totalCents, paidAt: summary.bookedAt }
          });
          if (!invoiceClaim.count) throw new Error("La factura ya fue conciliada por otra ejecucion");
          matched += claimed.count;
        });
        continue;
      }
    }
  }
  return matched;
}

async function reconcilePreviouslyUnmatchedIncomingPayments(workspaceId: string, startsAt: Date) {
  let matched = 0;
  const pending = await prisma.bankTransaction.findMany({
    where: { workspaceId, status: "UNMATCHED", amountCents: { gt: 0 }, bookedAt: { gte: startsAt } },
    select: { id: true, amountCents: true, bookedAt: true, reference: true, counterpartyName: true },
    orderBy: { bookedAt: "asc" },
    take: 200
  });
  const latestBookedAt = pending.at(-1)?.bookedAt;
  if (!latestBookedAt) return 0;
  const invoicePool = await prisma.invoice.findMany({
    where: { workspaceId, status: "ISSUED", deletedAt: null, totalCents: { gt: 0 }, issueDate: { lte: latestBookedAt } },
    select: { id: true, number: true, clientSnapshot: true, totalCents: true, paidCents: true, issueDate: true },
    orderBy: { issueDate: "desc" },
    take: 1000
  });

  for (const movement of pending) {
    if (/Emision Remesa Sepa|Remesa SEPA/i.test(movement.reference ?? "")) continue;
    const invoices = invoicePool.filter((invoice) => invoice.issueDate <= movement.bookedAt);
    const candidate = matchIncomingPayment({
      amountCents: movement.amountCents,
      reference: movement.reference ?? "",
      counterpartyName: movement.counterpartyName ?? ""
    }, invoices.map((invoice) => ({ ...invoice, clientName: clientName(invoice.clientSnapshot) })));
    if (!candidate) continue;
    const invoice = invoices.find((item) => item.id === candidate.invoiceId);
    if (!invoice) continue;

    await prisma.$transaction(async (tx) => {
      const invoiceClaim = await tx.invoice.updateMany({
        where: { id: invoice.id, workspaceId, status: "ISSUED", paidCents: 0 },
        data: { status: "PAID", paidCents: invoice.totalCents, paidAt: movement.bookedAt }
      });
      if (!invoiceClaim.count) return;
      const movementClaim = await tx.bankTransaction.updateMany({
        where: { id: movement.id, workspaceId, status: "UNMATCHED" },
        data: { status: "MATCHED", matchedInvoiceId: invoice.id, matchConfidence: candidate.confidence, matchedAt: new Date() }
      });
      if (!movementClaim.count) throw new Error("El movimiento ya fue conciliado por otra ejecuciÃ³n");
      matched += movementClaim.count;
    });
  }
  return matched;
}

function clientName(snapshot: unknown): string {
  const data = snapshot && typeof snapshot === "object" ? snapshot as Record<string, unknown> : {};
  return String(data.legalName ?? data.name ?? "").trim();
}

/**
 * Abonos de remesa SEPA ("Remesa SEPA <nº> · Contabilizada") → facturas.
 * Ver remittances.ts para las reglas. Resumen: se emparejan con las remesas
 * que el propio HUB preparó (importe exacto + vencimiento pocos días después) y
 * solo cuando el grupo de igual importe cuadra 1:1; las remesas manuales, solo
 * con importe único en ambos sentidos. Lo ambiguo queda en "Revisar".
 */
export async function reconcileSepaRemittanceAggregates(workspaceId: string, startsAt: Date): Promise<number> {
  const rows = await prisma.bankTransaction.findMany({
    where: { workspaceId, amountCents: { gt: 0 }, bookedAt: { gte: startsAt }, status: { in: ["MATCHED", "UNMATCHED"] } },
    select: { id: true, status: true, amountCents: true, bookedAt: true, reference: true, createdAt: true, matchedInvoiceId: true, matchConfidence: true }
  });

  // 1) La misma remesa entra por el listado de remesas y por la cuenta: una sola.
  const duplicates = duplicateRemittanceRowIds(rows);
  if (duplicates.length) {
    await prisma.bankTransaction.updateMany({ where: { workspaceId, id: { in: duplicates }, status: "UNMATCHED" }, data: { status: "IGNORED" } });
  }
  const duplicateSet = new Set(duplicates);

  const aggregates = rows
    .filter((row) => row.status === "UNMATCHED" && !duplicateSet.has(row.id) && row.matchConfidence !== "MANUAL_HOLD" && isRemittanceAggregate(row.reference))
    .map((row) => ({ id: row.id, amountCents: row.amountCents, bookedAt: row.bookedAt, code: remittanceCode(row.reference) }));
  if (!aggregates.length) return 0;

  // Facturas ya conciliadas con un ABONO de remesa: su remesa está consumida.
  // Las conciliadas con un RECIBO leído del detalle siguen necesitando su abono
  // (que es el mismo dinero): ese abono se marcará como duplicado, no se cobra dos veces.
  const consumedInvoices = new Set(rows.filter((row) => row.status === "MATCHED" && row.matchedInvoiceId && isRemittanceAggregate(row.reference)).map((row) => row.matchedInvoiceId!));
  const receiptInvoices = new Set(rows.filter((row) => row.status === "MATCHED" && row.matchedInvoiceId && /·\s*Recibo\s/i.test(row.reference ?? "")).map((row) => row.matchedInvoiceId!));

  const requests = await prisma.sepaRemittanceRequest.findMany({
    where: {
      workspaceId,
      archivedAt: null,
      status: { in: ["PENDING_SIGNATURE", "SIGNED"] },
      amountCents: { gt: 0 },
      createdAt: { gte: new Date(startsAt.getTime() - 30 * 24 * 60 * 60 * 1000) }
    },
    select: { id: true, invoiceId: true, companyId: true, amountCents: true, chargeDate: true, approvedAt: true, createdAt: true }
  });
  const requestInvoices = await prisma.invoice.findMany({
    where: { workspaceId, id: { in: [...new Set(requests.map((request) => request.invoiceId))] } },
    select: { id: true, status: true, totalCents: true, paidCents: true, deletedAt: true }
  });
  const invoiceById = new Map(requestInvoices.map((invoice) => [invoice.id, invoice]));
  const requestState = new Map<string, "OPEN" | "RECEIPT">();
  const candidates = requests.flatMap((request) => {
    const invoice = invoiceById.get(request.invoiceId);
    if (!invoice || invoice.deletedAt || consumedInvoices.has(invoice.id)) return [];
    const open = invoice.status === "ISSUED" && invoice.paidCents === 0 && invoice.totalCents === request.amountCents;
    const byReceipt = invoice.status === "PAID" && receiptInvoices.has(invoice.id);
    if (!open && !byReceipt) return [];
    requestState.set(request.id, open ? "OPEN" : "RECEIPT");
    return [{ id: request.id, amountCents: request.amountCents, preparedAt: request.chargeDate ?? request.approvedAt ?? request.createdAt }];
  });
  const requestById = new Map(requests.map((request) => [request.id, request]));
  const aggregateById = new Map(aggregates.map((aggregate) => [aggregate.id, aggregate]));

  let matched = 0;
  const { assignments, contested } = assignRemittanceGroups(aggregates, candidates);
  for (const assignment of assignments) {
    const aggregate = aggregateById.get(assignment.aggregateId)!;
    const request = requestById.get(assignment.requestId)!;
    if (requestState.get(request.id) === "RECEIPT") {
      // El cobro ya consta por el recibo; este abono es el mismo dinero.
      await prisma.bankTransaction.updateMany({ where: { id: aggregate.id, workspaceId, status: "UNMATCHED" }, data: { status: "IGNORED" } });
      continue;
    }
    matched += await claimMovementForInvoice(workspaceId, aggregate.id, request.invoiceId, aggregate.bookedAt, "SEPA_REMESA_HUB");
  }

  // 2) Remesas preparadas a mano en Santander (sin solicitud del HUB).
  const assignedAggregates = new Set(assignments.map((assignment) => assignment.aggregateId));
  const manualAggregates = aggregates.filter((aggregate) => !assignedAggregates.has(aggregate.id) && !contested.has(aggregate.id));
  if (manualAggregates.length) {
    const activeRequestInvoices = await prisma.sepaRemittanceRequest.findMany({
      where: { workspaceId, archivedAt: null, status: { notIn: ["REJECTED", "EXPIRED", "FAILED"] } },
      select: { invoiceId: true }
    });
    const withActiveRequest = new Set(activeRequestInvoices.map((item) => item.invoiceId));
    const issuerIds = [...new Set(requests.map((request) => request.companyId))];
    const openInvoices = (await prisma.invoice.findMany({
      where: {
        workspaceId, type: "NORMAL", status: "ISSUED", paidCents: 0, deletedAt: null, totalCents: { gt: 0 },
        issueDate: { gte: new Date(startsAt.getTime() - 15 * 24 * 60 * 60 * 1000) },
        ...(issuerIds.length ? { issuerId: { in: issuerIds } } : {})
      },
      select: { id: true, totalCents: true, issueDate: true }
    })).filter((invoice) => !withActiveRequest.has(invoice.id));
    for (const pair of assignManualRemittances(manualAggregates, openInvoices)) {
      const aggregate = aggregateById.get(pair.aggregateId)!;
      matched += await claimMovementForInvoice(workspaceId, aggregate.id, pair.invoiceId, aggregate.bookedAt, "SEPA_REMESA_IMPORTE_UNICO");
    }
  }
  return matched;
}

/** Concilia un movimiento con una factura de forma atómica (ambos o ninguno). */
async function claimMovementForInvoice(workspaceId: string, transactionId: string, invoiceId: string, paidAt: Date, confidence: string): Promise<number> {
  try {
    return await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, workspaceId, status: "ISSUED", paidCents: 0, deletedAt: null }, select: { id: true, totalCents: true } });
      if (!invoice) return 0;
      const movementClaim = await tx.bankTransaction.updateMany({
        where: { id: transactionId, workspaceId, status: "UNMATCHED", amountCents: invoice.totalCents },
        data: { status: "MATCHED", matchedInvoiceId: invoice.id, matchConfidence: confidence, matchedAt: new Date() }
      });
      if (!movementClaim.count) return 0;
      const invoiceClaim = await tx.invoice.updateMany({
        where: { id: invoice.id, workspaceId, status: "ISSUED", paidCents: 0 },
        data: { status: "PAID", paidCents: invoice.totalCents, paidAt }
      });
      if (!invoiceClaim.count) throw new Error("La factura ya fue conciliada por otra ejecución");
      return 1;
    });
  } catch (error) {
    console.error("[conciliación] no se pudo conciliar", transactionId, (error as Error)?.message ?? error);
    return 0;
  }
}

/** Conciliación manual desde la pantalla: mismo importe exacto, factura abierta. */
export async function manualMatchMovement(workspaceId: string, transactionId: string, invoiceId: string) {
  const movement = await prisma.bankTransaction.findFirst({
    where: { id: transactionId, workspaceId, status: "UNMATCHED", amountCents: { gt: 0 } },
    select: { id: true, bookedAt: true, amountCents: true }
  });
  if (!movement) throw new Error("El movimiento ya no está pendiente de revisar");
  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, workspaceId, status: "ISSUED", paidCents: 0, deletedAt: null }, select: { totalCents: true } });
  if (!invoice) throw new Error("La factura ya no está pendiente de cobro");
  if (invoice.totalCents !== movement.amountCents) throw new Error("El importe de la factura no coincide con el del movimiento");
  const done = await claimMovementForInvoice(workspaceId, movement.id, invoiceId, movement.bookedAt, "MANUAL");
  if (!done) throw new Error("No se pudo conciliar: otra ejecución modificó el movimiento o la factura");
}

/** Deshace una conciliación inferida o manual: la factura vuelve a "emitida" y
 *  el movimiento queda en revisión SIN volver a emparejarse solo. */
export async function undoMovementMatch(workspaceId: string, transactionId: string) {
  await prisma.$transaction(async (tx) => {
    const movement = await tx.bankTransaction.findFirst({
      where: { id: transactionId, workspaceId, status: "MATCHED" },
      select: { id: true, matchedInvoiceId: true, matchConfidence: true }
    });
    if (!movement) throw new Error("El movimiento no está conciliado");
    if (!UNDOABLE_CONFIDENCES.has(movement.matchConfidence ?? "")) throw new Error("Esta conciliación se basa en una referencia verificada y no se deshace desde aquí");
    await tx.bankTransaction.updateMany({
      where: { id: movement.id, workspaceId, status: "MATCHED" },
      data: { status: "UNMATCHED", matchedInvoiceId: null, matchConfidence: "MANUAL_HOLD", matchedAt: null }
    });
    if (movement.matchedInvoiceId) {
      const others = await tx.bankTransaction.count({ where: { workspaceId, matchedInvoiceId: movement.matchedInvoiceId, status: "MATCHED", id: { not: movement.id } } });
      if (!others) {
        await tx.invoice.updateMany({ where: { id: movement.matchedInvoiceId, workspaceId, status: "PAID" }, data: { status: "ISSUED", paidCents: 0, paidAt: null } });
      }
    }
  });
}

/** Descarta un movimiento que no es cobro de factura (no vuelve a revisión). */
export async function ignoreMovement(workspaceId: string, transactionId: string) {
  const done = await prisma.bankTransaction.updateMany({ where: { id: transactionId, workspaceId, status: "UNMATCHED" }, data: { status: "IGNORED" } });
  if (!done.count) throw new Error("El movimiento ya no está pendiente de revisar");
}

export async function importAndReconcileMovements(workspaceId: string, movements: IncomingBankMovement[]) {
  const config = await ensureReconciliationConfig(workspaceId);
  if (!config.enabled) return { imported: 0, matched: 0, ignored: movements.length };
  await repairDuplicateSepaReceipts(workspaceId);
  await repairMisreferencedTransfers(workspaceId);
  await repairUnmatchedExactReferences(workspaceId);
  await repairSyntheticSepaDuplicates(workspaceId);
  await reconcileUniqueSepaSummaries(workspaceId);
  await reconcilePreviouslyUnmatchedIncomingPayments(workspaceId, config.startsAt);
  let imported = 0;
  let matched = 0;
  let ignored = 0;

  for (const movement of movements) {
    const bookedAt = new Date(movement.bookedAt);
    if (!Number.isFinite(bookedAt.getTime()) || !shouldImportMovement({ bookedAt, amountCents: movement.amountCents }, config.startsAt)) {
      ignored++;
      continue;
    }
    const existing = await prisma.bankTransaction.findUnique({
      where: { workspaceId_provider_externalId: { workspaceId, provider: "SANTANDER", externalId: movement.externalId } },
      select: { id: true, status: true }
    });
    if (existing && !shouldReprocessExistingBankTransaction(existing.status, Boolean(movement.remittanceNumber && movement.debtorIbanLast4))) continue;

    if (movement.amountCents < 0) {
      const issuer = await prisma.invoiceIssuer.findFirst({ where: { workspaceId, deletedAt: null }, orderBy: { isDefault: "desc" }, select: { id: true } });
      const details = expenseDetails(clean(movement.reference));
      await prisma.$transaction(async (tx) => {
        await tx.bankTransaction.create({ data: {
          workspaceId, provider: "SANTANDER", externalId: movement.externalId.slice(0, 200), fingerprint: fingerprint(workspaceId, movement),
          bookedAt, valueAt: movement.valueAt ? new Date(movement.valueAt) : null, amountCents: movement.amountCents,
          currency: (movement.currency ?? "EUR").slice(0, 3), counterpartyName: clean(movement.counterpartyName, 200),
          reference: clean(movement.reference), accountMasked: clean(movement.accountMasked, 40), status: "EXPENSE"
        }});
        await tx.expense.create({ data: {
          workspaceId, issuerId: issuer?.id, date: movement.valueAt ? new Date(movement.valueAt) : bookedAt,
          category: details.category, supplier: details.supplier, concept: clean(movement.reference), currency: (movement.currency ?? "EUR").slice(0, 3),
          paymentMethod: details.paymentMethod, status: "PAID", baseCents: Math.abs(movement.amountCents), taxRate: 0,
          taxCents: 0, totalCents: Math.abs(movement.amountCents), deductible: false,
          notes: `Importado automáticamente desde Santander (${movement.externalId.slice(0, 12)}). Revisar IVA y adjuntar justificante.`
        }});
      });
      imported++;
      continue;
    }

    const recentRemittances = await prisma.sepaRemittanceRequest.findMany({
      where: { workspaceId, createdAt: { gte: config.startsAt }, archivedAt: null },
      select: { invoiceId: true }
    });
    const remittanceInvoiceIds = recentRemittances.map((item) => item.invoiceId);
    const preparedJobs = movement.remittanceNumber && movement.debtorIbanLast4
      ? await prisma.remittanceJob.findMany({
          where: {
            workspaceId,
            status: "PREPARED_PENDING_SIGNATURE",
            amountCents: movement.amountCents,
            chargeDate: { gte: config.startsAt }
          },
          select: { invoiceId: true, amountCents: true, ibanMasked: true, chargeDate: true, clientName: true, mandateRef: true }
        })
      : [];
    const activeRequests = movement.remittanceNumber && movement.debtorIbanLast4
      ? await prisma.sepaRemittanceRequest.findMany({
          where: {
            workspaceId,
            archivedAt: null,
            status: { in: ["APPROVED", "PREPARING", "PENDING_SIGNATURE", "SIGNED"] },
            amountCents: movement.amountCents,
            chargeDate: { gte: config.startsAt }
          },
          select: { invoiceId: true, amountCents: true, ibanMasked: true, chargeDate: true, clientName: true, mandateRef: true }
        })
      : [];
    const invoices = await prisma.invoice.findMany({
      where: {
        workspaceId,
        status: "ISSUED",
        deletedAt: null,
        totalCents: { gt: 0 },
        issueDate: { lte: bookedAt },
      },
      select: { id: true, number: true, clientSnapshot: true, totalCents: true, paidCents: true, issueDate: true },
      orderBy: { issueDate: "desc" },
      take: 500
    });
    const genericCandidate = requiresVerifiedSepaReceipt(movement.reference, movement.remittanceNumber) ? null : matchIncomingPayment({
      amountCents: movement.amountCents,
      reference: clean(movement.reference) ?? "",
      counterpartyName: clean(movement.counterpartyName, 200) ?? ""
    }, invoices.map((invoice) => ({ ...invoice, clientName: clientName(invoice.clientSnapshot) })));
    const sepaCandidate = movement.debtorIbanLast4
      ? matchSepaReceipt({ amountCents: movement.amountCents, debtorIbanLast4: movement.debtorIbanLast4, debtorName: movement.counterpartyName, bookedAt }, [...preparedJobs, ...activeRequests])
      : null;
    const candidate = sepaCandidate ?? genericCandidate;
    let appliedCandidate = retainEligiblePaymentMatch(candidate, invoices.map((invoice) => invoice.id));
    const aggregateTransaction = movement.remittanceNumber && movement.debtorIbanLast4
      ? existing ?? await prisma.bankTransaction.findFirst({
          where: {
            workspaceId,
            provider: "SANTANDER",
            status: "UNMATCHED",
            amountCents: movement.amountCents,
            reference: { contains: movement.remittanceNumber }
          },
          select: { id: true }
        })
      : null;

    let createdTransaction = false;
    await prisma.$transaction(async (tx) => {
      if (appliedCandidate) {
        const invoice = invoices.find((item) => item.id === appliedCandidate!.invoiceId)!;
        const invoiceClaim = await tx.invoice.updateMany({
          where: { id: invoice.id, workspaceId, status: "ISSUED", paidCents: 0 },
          data: { status: "PAID", paidCents: invoice.totalCents, paidAt: bookedAt }
        });
        if (!invoiceClaim.count) appliedCandidate = null;
      }
      const transactionData = {
          workspaceId,
          provider: "SANTANDER",
          externalId: movement.externalId.slice(0, 200),
          fingerprint: fingerprint(workspaceId, movement),
          bookedAt,
          valueAt: movement.valueAt ? new Date(movement.valueAt) : null,
          amountCents: movement.amountCents,
          currency: (movement.currency ?? "EUR").slice(0, 3),
          counterpartyName: clean(movement.counterpartyName, 200),
          reference: clean(persistedBankReference(movement.reference, movement.remittanceNumber)),
          accountMasked: clean(movement.accountMasked, 40),
          status: appliedCandidate ? "MATCHED" : "UNMATCHED",
          matchedInvoiceId: appliedCandidate?.invoiceId,
          matchConfidence: appliedCandidate?.confidence,
          matchedAt: appliedCandidate ? new Date() : null
      };
      if (aggregateTransaction) {
        const { workspaceId: _workspaceId, provider: _provider, externalId: _externalId, ...repairData } = transactionData;
        const movementClaim = await tx.bankTransaction.updateMany({
          where: { id: aggregateTransaction.id, workspaceId, status: "UNMATCHED" },
          data: repairData
        });
        if (!movementClaim.count) throw new Error("Movimiento conciliado por otra ejecucion");
      } else {
        await tx.bankTransaction.create({ data: transactionData });
        createdTransaction = true;
      }
    });
    if (createdTransaction) imported++;
    if (appliedCandidate) matched++;
  }

  // Los abonos agregados de cuenta no incluyen cliente ni factura. Una vez
  // importados, se vinculan en esta misma ejecución con la solicitud SEPA
  // única por importe y ventana de liquidación; los ambiguos siguen en revisión.
  matched += await reconcileUniqueSepaSummaries(workspaceId);
  matched += await reconcilePreviouslyUnmatchedIncomingPayments(workspaceId, config.startsAt);
  matched += await reconcileSepaRemittanceAggregates(workspaceId, config.startsAt);

  await prisma.bankReconciliationConfig.update({
    where: { workspaceId },
    data: { lastSyncAt: new Date(), lastError: null, profile: { ...((config.profile as Record<string, unknown>) ?? {}), retryState: null } }
  });
  return { imported, matched, ignored };
}

type RetryState = { attempts: number; lastFailureAt: string; notifiedAt?: string };

export async function recordReconciliationFailure(workspaceId: string, reason: string) {
  const config = await ensureReconciliationConfig(workspaceId);
  const profile = (config.profile as Record<string, unknown> | null) ?? {};
  const previous = (profile.retryState as RetryState | null) ?? null;
  const now = new Date();
  const today = madridDay(now);
  const sameDay = previous?.lastFailureAt && madridDay(new Date(previous.lastFailureAt)) === today;
  const attempts = sameDay ? Math.min(3, previous.attempts + 1) : 1;
  const shouldNotify = attempts >= 3 && !(sameDay && previous?.notifiedAt);
  let notifiedAt = sameDay ? previous?.notifiedAt : undefined;

  await prisma.bankReconciliationConfig.update({
    where: { workspaceId },
    data: { lastError: reason.slice(0, 1000), profile: { ...profile, retryState: { attempts, lastFailureAt: now.toISOString(), ...(notifiedAt ? { notifiedAt } : {}) } } }
  });

  if (shouldNotify) {
    await sendEmail({
      to: "info@negociovivo.com",
      workspaceId,
      subject: "⚠️ Facturación · conciliación bloqueada tras 3 intentos",
      html: `<p>La conciliación bancaria automática no ha podido completarse después de 3 intentos.</p><p><b>Error:</b> ${escapeHtml(reason.slice(0, 1000))}</p><p>El agente volverá a intentarlo en la siguiente ejecución diaria. Revisa que el PC-Oficina, Chrome y la sesión de Santander estén disponibles.</p>`,
      text: `La conciliación bancaria no ha podido completarse después de 3 intentos. Error: ${reason.slice(0, 1000)}`
    });
    notifiedAt = new Date().toISOString();
    await prisma.bankReconciliationConfig.update({
      where: { workspaceId },
      data: { profile: { ...profile, retryState: { attempts, lastFailureAt: now.toISOString(), notifiedAt } } }
    });
  }
  return { attempts, notified: Boolean(notifiedAt) };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]!);
}

export async function reconciliationDashboard(workspaceId: string) {
  const config = await ensureReconciliationConfig(workspaceId);
  await repairDuplicateSepaReceipts(workspaceId);
  await repairMisreferencedTransfers(workspaceId);
  await repairUnmatchedExactReferences(workspaceId);
  await repairSyntheticSepaDuplicates(workspaceId);
  await reconcileUniqueSepaSummaries(workspaceId);
  try {
    await reconcileSepaRemittanceAggregates(workspaceId, config.startsAt);
  } catch (error) {
    console.error("[conciliación] fallo al conciliar abonos de remesa", error);
  }
  const [items, matched, unmatched] = await Promise.all([
    prisma.bankTransaction.findMany({
      where: { workspaceId, bookedAt: { gte: config.startsAt }, status: { in: ["MATCHED", "UNMATCHED"] } },
      orderBy: { bookedAt: "desc" },
      take: 200,
      include: { invoice: { select: { id: true, number: true, clientSnapshot: true, totalCents: true } } }
    }),
    prisma.bankTransaction.count({ where: { workspaceId, status: "MATCHED", bookedAt: { gte: config.startsAt } } }),
    prisma.bankTransaction.count({ where: { workspaceId, status: "UNMATCHED", bookedAt: { gte: config.startsAt } } })
  ]);
  // Sugerencias para conciliar a mano lo que queda en revisión.
  const pending = items.filter((item) => item.status === "UNMATCHED" && item.amountCents > 0);
  const openInvoices = pending.length ? await prisma.invoice.findMany({
    where: { workspaceId, status: "ISSUED", paidCents: 0, deletedAt: null, totalCents: { in: [...new Set(pending.map((item) => item.amountCents))] } },
    select: { id: true, number: true, clientSnapshot: true, totalCents: true, issueDate: true },
    orderBy: { issueDate: "desc" },
    take: 1000
  }) : [];
  const withSuggestions = items.map((item) => ({
    ...item,
    undoable: item.status === "MATCHED" && UNDOABLE_CONFIDENCES.has(item.matchConfidence ?? ""),
    suggestions: item.status === "UNMATCHED" && item.amountCents > 0
      ? suggestInvoicesForMovement(item, openInvoices).map((invoice) => ({ id: invoice.id, number: invoice.number, client: clientName(invoice.clientSnapshot), issueDate: invoice.issueDate }))
      : []
  }));
  return { config, summary: { matched, unmatched }, items: withSuggestions };
}

export async function requestReconciliation(workspaceId: string) {
  const config = await ensureReconciliationConfig(workspaceId);
  const requested = await prisma.bankReconciliationConfig.update({
    where: { workspaceId },
    data: { lastSyncAt: null, lastError: null, profile: profileForForcedReconciliation(config.profile) as Prisma.InputJsonValue }
  });
  if (!config.enabled) return requested;

  // La solicitud ya esta persistida: aunque esta reparacion inmediata falle,
  // el agente conserva el encargo de escanear Santander como fallback.
  try {
    await reconcileUniqueSepaSummaries(workspaceId);
    await reconcilePreviouslyUnmatchedIncomingPayments(workspaceId, config.startsAt);
    await reconcileSepaRemittanceAggregates(workspaceId, config.startsAt);
  } catch (error) {
    console.error("No se pudieron reconciliar inmediatamente los movimientos almacenados", error);
  }
  return requested;
}
