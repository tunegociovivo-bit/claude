import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { matchIncomingPayment, shouldImportMovement } from "./matching";

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
  return prisma.bankReconciliationConfig.upsert({
    where: { workspaceId },
    create: {
      workspaceId,
      enabled: true,
      startsAt: NEGOCIO_VIVO_RECONCILIATION_START,
      provider: "SANTANDER",
      pollMinutes: 30,
      profile: {
        schemaVersion: 1,
        santanderOrigin: "https://empresas3.gruposantander.es",
        reconciliationMode: "account-movements",
        storesBankCredentials: false
      }
    },
    update: {}
  });
}

function clientName(snapshot: unknown): string {
  const data = snapshot && typeof snapshot === "object" ? snapshot as Record<string, unknown> : {};
  return String(data.legalName ?? data.name ?? "").trim();
}

export async function importAndReconcileMovements(workspaceId: string, movements: IncomingBankMovement[]) {
  const config = await ensureReconciliationConfig(workspaceId);
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

    const recentRemittances = await prisma.sepaRemittanceRequest.findMany({
      where: { workspaceId, createdAt: { gte: config.startsAt }, archivedAt: null },
      select: { invoiceId: true }
    });
    const remittanceInvoiceIds = recentRemittances.map((item) => item.invoiceId);
    const invoices = await prisma.invoice.findMany({
      where: {
        workspaceId,
        status: "ISSUED",
        deletedAt: null,
        totalCents: { gt: 0 },
        issueDate: { lte: bookedAt },
        OR: [
          { issueDate: { gte: config.startsAt } },
          ...(remittanceInvoiceIds.length ? [{ id: { in: remittanceInvoiceIds } }] : [])
        ]
      },
      select: { id: true, number: true, clientSnapshot: true, totalCents: true, paidCents: true, issueDate: true },
      orderBy: { issueDate: "desc" },
      take: 500
    });
    const candidate = matchIncomingPayment({
      amountCents: movement.amountCents,
      reference: clean(movement.reference) ?? "",
      counterpartyName: clean(movement.counterpartyName, 200) ?? ""
    }, invoices.map((invoice) => ({ ...invoice, clientName: clientName(invoice.clientSnapshot) })));

    await prisma.$transaction(async (tx) => {
      await tx.bankTransaction.create({
        data: {
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
        }
      });
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
  const [items, matched, unmatched] = await Promise.all([
    prisma.bankTransaction.findMany({
      where: { workspaceId, bookedAt: { gte: config.startsAt } },
      orderBy: { bookedAt: "desc" },
      take: 200,
      include: { invoice: { select: { id: true, number: true, clientSnapshot: true, totalCents: true } } }
    }),
    prisma.bankTransaction.count({ where: { workspaceId, status: "MATCHED", bookedAt: { gte: config.startsAt } } }),
    prisma.bankTransaction.count({ where: { workspaceId, status: "UNMATCHED", bookedAt: { gte: config.startsAt } } })
  ]);
  return { config, summary: { matched, unmatched }, items };
}
