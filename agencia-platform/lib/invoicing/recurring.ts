import { prisma } from "@/lib/db/prisma";
import { assignInvoiceNumber } from "./numbering";
import { defaultSeriesForType } from "./core";
import { addInvoiceInterval, addInvoicePaymentDays, type InvoiceRecurrenceUnit } from "./invoice-form";

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  // Evita el "spill" de meses cortos (31 ene + 1 mes ≠ 3 mar).
  if (d.getDate() < day) d.setDate(0);
  return d;
}

function advanceRecurrence(date: Date, config: any): Date {
  const unit = (config.intervalUnit ?? "MONTHS") as InvoiceRecurrenceUnit;
  const value = Math.max(1, Number(config.intervalValue ?? config.intervalMonths) || 1);
  return new Date(`${addInvoiceInterval(date.toISOString().slice(0, 10), unit, value)}T00:00:00.000Z`);
}

/**
 * Genera las facturas de las PLANTILLAS recurrentes que toca emitir
 * (recurrenceConfig.nextRunAt <= ahora). Por cada plantilla:
 *   - crea una factura real (ISSUED) con número correlativo y snapshots,
 *   - avanza nextRunAt según intervalMonths,
 *   - desactiva la plantilla si supera endsAt.
 * Pensada para ejecutarse desde el cron interno (cada 5 min).
 */
export async function runRecurringInvoices(now = new Date()): Promise<{ generated: number }> {
  const templates = await prisma.invoice.findMany({
    where: { recurring: true, deletedAt: null, status: { not: "CANCELLED" } }
  });

  let generated = 0;
  for (const tpl of templates) {
    const cfg = (tpl.recurrenceConfig as any) ?? {};
    const interval = Math.max(1, Number(cfg.intervalMonths) || 1);
    const nextRunAt = cfg.nextRunAt ? new Date(cfg.nextRunAt) : new Date(tpl.issueDate);
    const endsAt = cfg.endsAt ? new Date(cfg.endsAt) : null;

    if (nextRunAt > now) continue;
    if (endsAt && now > endsAt) {
      await prisma.invoice
        .update({ where: { id: tpl.id }, data: { recurring: false } })
        .catch(() => {});
      continue;
    }

    const series = (tpl.series || defaultSeriesForType(tpl.type as any)) as string;
    const occurrenceKey = `recurring:${tpl.id}:${nextRunAt.toISOString()}`;
    let occurrenceHandled = false;
    for (let attempt = 0; attempt < 3 && !occurrenceHandled; attempt++) {
      try {
        const wasCreated = await prisma.$transaction(async (tx) => {
          const existing = await tx.invoice.findUnique({
            where: { workspaceId_creationKey: { workspaceId: tpl.workspaceId, creationKey: occurrenceKey } },
            select: { id: true }
          });
          if (existing) return false;
          const number = await assignInvoiceNumber(tpl.workspaceId, series, now.getFullYear(), tx);
          await tx.invoice.create({
            data: {
              workspaceId: tpl.workspaceId,
              type: tpl.type,
              status: "ISSUED",
              series,
              number,
              issuerId: tpl.issuerId,
              clientId: tpl.clientId,
              issuerSnapshot: tpl.issuerSnapshot ?? undefined,
              clientSnapshot: tpl.clientSnapshot ?? undefined,
              issueDate: nextRunAt,
              dueDate: new Date(`${addInvoicePaymentDays(nextRunAt.toISOString().slice(0, 10), 30)}T00:00:00.000Z`),
              currency: tpl.currency,
              paymentMethod: tpl.paymentMethod,
              lines: tpl.lines ?? [],
              subtotalCents: tpl.subtotalCents,
              discountCents: tpl.discountCents,
              taxCents: tpl.taxCents,
              totalCents: tpl.totalCents,
              notes: tpl.notes,
              terms: tpl.terms,
              recurringSourceId: tpl.id,
              creationKey: occurrenceKey
            }
          });
          return true;
        }, { isolationLevel: "Serializable" });
        if (wasCreated) generated++;
        occurrenceHandled = true;
      } catch (error: any) {
        if (error?.code !== "P2002" && error?.code !== "P2034") throw error;
        const existing = await prisma.invoice.findUnique({
          where: { workspaceId_creationKey: { workspaceId: tpl.workspaceId, creationKey: occurrenceKey } },
          select: { id: true }
        });
        if (existing) occurrenceHandled = true;
        else if (attempt === 2) throw error;
      }
    }
    if (!occurrenceHandled) throw new Error(`No se pudo reclamar la ocurrencia ${occurrenceKey}`);

    // Avanza la próxima ejecución desde la prevista (no desde "ahora"),
    // para no derivar la fecha si el cron se ejecutó con retraso.
    let next = cfg.intervalUnit ? advanceRecurrence(nextRunAt, cfg) : addMonths(nextRunAt, interval);
    while (next <= now) next = cfg.intervalUnit ? advanceRecurrence(next, cfg) : addMonths(next, interval);
    await prisma.invoice.update({
      where: { id: tpl.id },
      data: { recurrenceConfig: { ...cfg, intervalMonths: interval, nextRunAt: next.toISOString() } }
    });
  }

  return { generated };
}
