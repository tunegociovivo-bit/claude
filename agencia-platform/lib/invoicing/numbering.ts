import { prisma } from "@/lib/db/prisma";

/**
 * Asigna el siguiente número correlativo para una serie y año, de forma
 * atómica (el contador vive en InvoiceCounter). Formato:
 *   {series}-{year}-{0001}   p.ej. "FAC-2026-0001"
 *
 * La correlatividad por serie+año es un requisito legal en España.
 */
export async function assignInvoiceNumber(
  workspaceId: string,
  series: string,
  year = new Date().getFullYear(),
  transactionClient?: any
): Promise<string> {
  const serie = (series || "FAC").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "FAC";

  const allocate = async (tx: any) => {
    const existing = await tx.invoiceCounter.findUnique({
      where: { workspaceId_series_year: { workspaceId, series: serie, year } }
    });
    if (!existing) {
      const created = await tx.invoiceCounter.create({
        data: { workspaceId, series: serie, year, next: 2 }
      });
      return { value: 1, _c: created };
    }
    const updated = await tx.invoiceCounter.update({
      where: { workspaceId_series_year: { workspaceId, series: serie, year } },
      data: { next: existing.next + 1 }
    });
    return { value: existing.next, _c: updated };
  };

  let counter: { value: number; _c: unknown } | undefined;
  if (transactionClient) counter = await allocate(transactionClient);
  else {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        counter = await prisma.$transaction(allocate, { isolationLevel: "Serializable" });
        break;
      } catch (error: any) {
        if (error?.code !== "P2034" || attempt === 2) throw error;
      }
    }
  }
  if (!counter) throw new Error("No se pudo reservar el número de factura");

  const padded = String(counter.value).padStart(4, "0");
  return `${serie}-${year}-${padded}`;
}
