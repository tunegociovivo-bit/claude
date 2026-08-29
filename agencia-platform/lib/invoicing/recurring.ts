import { prisma } from "@/lib/db/prisma";
import { assignInvoiceNumber } from "./numbering";
import { defaultSeriesForType } from "./core";
import { addInvoicePaymentDays, recurringOccurrenceSchedule, type InvoiceRecurrenceUnit } from "./invoice-form";
import { sendInvoiceAutomatically } from "./send";

async function deliverRecurringOccurrence(template: any, invoice: any, occurrenceKey: string): Promise<void> {
  if (template.status !== "SENT" || invoice.status === "SENT") return;
  try {
    await sendInvoiceAutomatically(template.workspaceId, invoice, `invoice:${occurrenceKey}:send`);
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: "SENT", sentAt: new Date(), deliveryError: null }
    });
  } catch (error: any) {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { deliveryError: String(error?.message ?? "No se pudo enviar la factura recurrente").slice(0, 500) }
    }).catch(() => {});
    throw error;
  }
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
    if (endsAt && nextRunAt > endsAt) {
      await prisma.invoice
        .update({ where: { id: tpl.id }, data: { recurring: false } })
        .catch(() => {});
      continue;
    }

    const series = (tpl.series || defaultSeriesForType(tpl.type as any)) as string;
    const unit = (cfg.intervalUnit ?? "MONTHS") as InvoiceRecurrenceUnit;
    const value = Math.max(1, Number(cfg.intervalValue ?? cfg.intervalMonths) || 1);
    const through = endsAt && endsAt < now ? endsAt : now;
    const schedule = recurringOccurrenceSchedule(
      nextRunAt.toISOString().slice(0, 10),
      through.toISOString().slice(0, 10),
      unit,
      value
    );
    let templateFailed = false;
    for (const occurrenceDate of schedule.dueDates) {
    const occurrence = new Date(`${occurrenceDate}T00:00:00.000Z`);
    const occurrenceKey = `recurring:${tpl.id}:${occurrence.toISOString()}`;
    let occurrenceHandled = false;
    for (let attempt = 0; attempt < 3 && !occurrenceHandled; attempt++) {
      try {
        const result = await prisma.$transaction(async (tx) => {
          const existing = await tx.invoice.findUnique({
            where: { workspaceId_creationKey: { workspaceId: tpl.workspaceId, creationKey: occurrenceKey } }
          });
          if (existing) return { invoice: existing, created: false };
          const number = await assignInvoiceNumber(tpl.workspaceId, series, occurrence.getUTCFullYear(), tx);
          const invoice = await tx.invoice.create({
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
              issueDate: occurrence,
              dueDate: new Date(`${addInvoicePaymentDays(occurrenceDate, 30)}T00:00:00.000Z`),
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
          return { invoice, created: true };
        }, { isolationLevel: "Serializable" });
        if (result.created) generated++;
        await deliverRecurringOccurrence(tpl, result.invoice, occurrenceKey);
        occurrenceHandled = true;
      } catch (error: any) {
        if (error?.code !== "P2002" && error?.code !== "P2034") break;
        const existing = await prisma.invoice.findUnique({
          where: { workspaceId_creationKey: { workspaceId: tpl.workspaceId, creationKey: occurrenceKey } }
        });
        if (existing) {
          try {
            await deliverRecurringOccurrence(tpl, existing, occurrenceKey);
            occurrenceHandled = true;
          } catch {
            break;
          }
        }
      }
    }
    if (!occurrenceHandled) {
      templateFailed = true;
      console.error(`[invoicing-recurring] occurrence pending retry: ${occurrenceKey}`);
      break;
    }
    }

    // No avanzamos esta plantilla si una ocurrencia no se envió. El siguiente
    // cron la retomará con la misma clave idempotente, sin bloquear las demás.
    if (templateFailed) continue;

    // Avanza la próxima ejecución desde la prevista (no desde "ahora"),
    // para no derivar la fecha si el cron se ejecutó con retraso.
    const next = new Date(`${schedule.nextRunAt}T00:00:00.000Z`);
    await prisma.invoice.update({
      where: { id: tpl.id },
      data: {
        recurring: endsAt && next > endsAt ? false : true,
        recurrenceConfig: { ...cfg, intervalMonths: interval, intervalUnit: unit, intervalValue: value, nextRunAt: next.toISOString() }
      }
    });
  }

  return { generated };
}
