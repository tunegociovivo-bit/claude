import { prisma } from "@/lib/db/prisma";

type InvoiceDetail = {
  number?: string;
  date?: string;
  amountCents?: number;
  currency?: string;
};

type ArchivedFile = { id?: string; name?: string };

export async function syncAccountancyRunItemExpenses(itemId: string) {
  const item = await prisma.accountancyInvoiceRunItem.findUnique({
    where: { id: itemId },
    include: { run: { select: { workspaceId: true, periodKey: true } } }
  });
  if (!item || item.source !== "GOOGLE_ADS") return 0;

  const files = Array.isArray(item.files) ? item.files as ArchivedFile[] : [];
  const details = Array.isArray(item.invoiceDetails) ? item.invoiceDetails as InvoiceDetail[] : [];
  let created = 0;

  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    if (!file?.id) continue;
    const marker = `[accountancy-file:${file.id}]`;
    const existing = await prisma.expense.findFirst({
      where: { workspaceId: item.run.workspaceId, deletedAt: null, notes: { contains: marker } },
      select: { id: true, totalCents: true }
    });
    const detail = details[index] || {};
    const totalCents = Math.max(0, Math.round(Number(detail.amountCents) || (files.length === 1 ? item.amountCents : 0)));
    if (existing) {
      if (!existing.totalCents && totalCents) await prisma.expense.update({ where: { id: existing.id }, data: { baseCents: totalCents, totalCents } });
      continue;
    }
    await prisma.expense.create({
      data: {
        workspaceId: item.run.workspaceId,
        date: detail.date && !Number.isNaN(Date.parse(detail.date)) ? new Date(detail.date) : item.finishedAt || new Date(),
        category: "PUBLICIDAD",
        supplier: "Google Ads",
        concept: `Publicidad Google Ads — ${item.clientName}${detail.number ? ` · ${detail.number}` : ""}`,
        currency: detail.currency || item.currency || "EUR",
        paymentMethod: "CARD",
        status: "PAID",
        baseCents: totalCents,
        taxRate: 0,
        taxCents: 0,
        totalCents,
        deductible: true,
        fileUrl: `/api/accountancy-invoices/files/${file.id}?download=1`,
        notes: `${marker} Importado automáticamente desde Facturas gestoría (${item.run.periodKey}). Revisar el desglose fiscal si procede.`
      }
    });
    created++;
  }
  return created;
}

export async function syncAllAccountancyExpenses(workspaceId: string) {
  const items = await prisma.accountancyInvoiceRunItem.findMany({
    where: { source: "GOOGLE_ADS", status: "DOWNLOADED", run: { workspaceId } },
    select: { id: true }
  });
  let created = 0;
  for (const item of items) created += await syncAccountancyRunItemExpenses(item.id);
  return created;
}
