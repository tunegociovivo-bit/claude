import { prisma } from "@/lib/db/prisma";
import { nextInvoiceSequenceFromNumbers } from "./invoice-form";

/** Hace monotónico el contador usando todos los números ya visibles, incluidos borradores personalizados. */
export async function synchronizeInvoiceCounters(workspaceId: string): Promise<void> {
  const invoices = await prisma.invoice.findMany({
    where: { workspaceId, deletedAt: null, number: { not: null } },
    select: { number: true, series: true, issueDate: true }
  });
  const groups = new Map<string, { series: string; year: number; numbers: Array<string | null> }>();
  for (const invoice of invoices) {
    const series = (invoice.series || invoice.number?.split("-")[0] || "FAC").toUpperCase();
    const year = Number(invoice.number?.split("-")[1]) || invoice.issueDate.getUTCFullYear();
    const key = `${series}:${year}`;
    const group = groups.get(key) ?? { series, year, numbers: [] };
    group.numbers.push(invoice.number);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const requiredNext = nextInvoiceSequenceFromNumbers(group.numbers, group.series, group.year);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await prisma.$transaction(async (tx) => {
          const current = await tx.invoiceCounter.findUnique({
            where: { workspaceId_series_year: { workspaceId, series: group.series, year: group.year } }
          });
          if (!current) {
            await tx.invoiceCounter.create({ data: { workspaceId, series: group.series, year: group.year, next: requiredNext } });
          } else if (current.next < requiredNext) {
            await tx.invoiceCounter.update({
              where: { workspaceId_series_year: { workspaceId, series: group.series, year: group.year } },
              data: { next: requiredNext }
            });
          }
        }, { isolationLevel: "Serializable" });
        break;
      } catch (error: any) {
        if ((error?.code !== "P2002" && error?.code !== "P2034") || attempt === 2) throw error;
      }
    }
  }
}
