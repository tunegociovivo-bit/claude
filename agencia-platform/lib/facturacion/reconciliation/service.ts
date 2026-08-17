import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { matchIncomingPayment, matchSepaReceipt, matchUniqueSepaSummary, shouldImportMovement } from "./matching";

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
  const oldVersion = Number((existing?.profile as Record<string, unknown> | null)?.schemaVersion ?? 0);
  return prisma.bankReconciliationConfig.upsert({
    where: { workspaceId },
    create: {
      workspaceId,
      enabled: true,
      startsAt: NEGOCIO_VIVO_RECONCILIATION_START,
      provider: "SANTANDER",
      pollMinutes: 1440,
      profile: {
        schemaVersion: 4,
        santanderOrigin: "https://empresas3.gruposantander.es",
        reconciliationMode: "sepa-core-receipts-and-account-expenses",
        dailyAt: "08:00",
        timeZone: "Europe/Madrid",
        storesBankCredentials: false
      }
    },
    update: {
      pollMinutes: 1440,
      profile: {
        schemaVersion: 4,
        santanderOrigin: "https://empresas3.gruposantander.es",
        reconciliationMode: "sepa-core-receipts-and-account-expenses",
        dailyAt: "08:00",
        timeZone: "Europe/Madrid",
        storesBankCredentials: false
      },
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

async function reconcileUniqueSepaSummaries(workspaceId: string) {
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
    select: { id: true, amountCents: true, bookedAt: true }
  });
  for (const summary of summaries) {
    const nearbyRequests = await prisma.sepaRemittanceRequest.findMany({
      where: {
        workspaceId,
        archivedAt: null,
        status: { in: ["PENDING_SIGNATURE", "SIGNED"] },
        amountCents: summary.amountCents,
        chargeDate: {
          gte: new Date(summary.bookedAt.getTime() - 18 * 60 * 60 * 1000),
          lt: new Date(summary.bookedAt.getTime() + 18 * 60 * 60 * 1000)
        }
      },
      select: { invoiceId: true, amountCents: true, chargeDate: true }
    });
    const requestMatch = matchUniqueSepaSummary({ amountCents: summary.amountCents, bookedAt: summary.bookedAt }, nearbyRequests);
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
          await tx.invoice.updateMany({
            where: { id: invoice.id, workspaceId, status: "ISSUED", paidCents: 0 },
            data: { status: "PAID", paidCents: invoice.totalCents, paidAt: summary.bookedAt }
          });
        });
        continue;
      }
    }
    const candidates = await prisma.invoice.findMany({
      where: {
        workspaceId,
        status: "ISSUED",
        deletedAt: null,
        issueDate: { lte: summary.bookedAt },
        totalCents: summary.amountCents,
        paidCents: 0
      },
      select: { id: true, totalCents: true },
      take: 2
    });
    if (candidates.length !== 1) continue;
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.bankTransaction.updateMany({
        where: { id: summary.id, workspaceId, status: "UNMATCHED" },
        data: { status: "MATCHED", matchedInvoiceId: candidates[0].id, matchConfidence: "SEPA_UNIQUE_AMOUNT", matchedAt: new Date() }
      });
      if (!claimed.count) return;
      await tx.invoice.updateMany({
        where: { id: candidates[0].id, workspaceId, status: "ISSUED", paidCents: 0 },
        data: { status: "PAID", paidCents: candidates[0].totalCents, paidAt: summary.bookedAt }
      });
    });
  }
}

function clientName(snapshot: unknown): string {
  const data = snapshot && typeof snapshot === "object" ? snapshot as Record<string, unknown> : {};
  return String(data.legalName ?? data.name ?? "").trim();
}

export async function importAndReconcileMovements(workspaceId: string, movements: IncomingBankMovement[]) {
  const config = await ensureReconciliationConfig(workspaceId);
  await repairDuplicateSepaReceipts(workspaceId);
  await repairMisreferencedTransfers(workspaceId);
  await reconcileUniqueSepaSummaries(workspaceId);
  if (!config.enabled) return { imported: 0, matched: 0, ignored: movements.length };
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
      select: { id: true }
    });
    if (existing) continue;

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
          select: { invoiceId: true, amountCents: true, ibanMasked: true, chargeDate: true }
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
    const genericCandidate = matchIncomingPayment({
      amountCents: movement.amountCents,
      reference: clean(movement.reference) ?? "",
      counterpartyName: clean(movement.counterpartyName, 200) ?? ""
    }, invoices.map((invoice) => ({ ...invoice, clientName: clientName(invoice.clientSnapshot) })));
    const sepaCandidate = movement.debtorIbanLast4
      ? matchSepaReceipt({ amountCents: movement.amountCents, debtorIbanLast4: movement.debtorIbanLast4, bookedAt }, preparedJobs)
      : null;
    const candidate = sepaCandidate ?? genericCandidate;
    const aggregateTransaction = movement.remittanceNumber && movement.debtorIbanLast4
      ? await prisma.bankTransaction.findFirst({
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

    await prisma.$transaction(async (tx) => {
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
          reference: clean(movement.reference),
          accountMasked: clean(movement.accountMasked, 40),
          status: candidate ? "MATCHED" : "UNMATCHED",
          matchedInvoiceId: candidate?.invoiceId,
          matchConfidence: candidate?.confidence,
          matchedAt: candidate ? new Date() : null
      };
      if (aggregateTransaction) {
        const { workspaceId: _workspaceId, provider: _provider, externalId: _externalId, ...repairData } = transactionData;
        await tx.bankTransaction.update({ where: { id: aggregateTransaction.id }, data: repairData });
      } else {
        await tx.bankTransaction.create({ data: transactionData });
      }
      if (candidate) {
        const invoice = invoices.find((item) => item.id === candidate.invoiceId)!;
        await tx.invoice.updateMany({
          where: { id: invoice.id, workspaceId, status: "ISSUED" },
          data: { status: "PAID", paidCents: invoice.totalCents, paidAt: bookedAt }
        });
      }
    });
    imported++;
    if (candidate) matched++;
  }

  await prisma.bankReconciliationConfig.update({
    where: { workspaceId },
    data: { lastSyncAt: new Date(), lastError: null }
  });
  return { imported, matched, ignored };
}

export async function reconciliationDashboard(workspaceId: string) {
  const config = await ensureReconciliationConfig(workspaceId);
  await repairDuplicateSepaReceipts(workspaceId);
  await repairMisreferencedTransfers(workspaceId);
  await reconcileUniqueSepaSummaries(workspaceId);
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
  return { config, summary: { matched, unmatched }, items };
}

export async function requestReconciliation(workspaceId: string) {
  await ensureReconciliationConfig(workspaceId);
  return prisma.bankReconciliationConfig.update({
    where: { workspaceId },
    data: { lastSyncAt: null, lastError: null }
  });
}
