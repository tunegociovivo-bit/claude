/**
 * Readiness / reconciliación (Slice E0) — SOLO LECTURA. Trae los previews shadow
 * del Hub y las facturas ya generadas por el legado (recientes), y los reconcilia.
 * NO escribe nada, NO activa, NO congela Holded, NO emite. Tenant SIEMPRE.
 */
import { reconcile, periodOf, type HubPreview, type LegacyInvoice, type ReconciliationReport, type Readiness } from "./reconcile";

type PrismaLike = any;
const CAP = 5000;

/** Primer día (UTC) del mes que queda `months` meses antes de `now`. Evita el mes
 *  parcial de una ventana de "30 días" (ruido de frontera). */
function windowStartUTC(now: Date, months: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
}

export async function readinessReport(prisma: PrismaLike, workspaceId: string, now = new Date(), months = 6): Promise<ReconciliationReport & { windowMonths: number; truncated: boolean }> {
  const since = windowStartUTC(now, months);

  const [previews, legacy] = await Promise.all([
    prisma.recurringInvoicePreview.findMany({
      where: { workspaceId, occurrenceDate: { gte: since } },
      select: { occurrenceDate: true, totalCents: true, template: { select: { externalId: true } } },
      orderBy: { occurrenceDate: "asc" },
      take: CAP
    }),
    // Facturas REALES generadas por el motor legado (recurringSourceId != null).
    prisma.invoice.findMany({
      where: { workspaceId, deletedAt: null, recurringSourceId: { not: null }, issueDate: { gte: since } },
      select: { recurringSourceId: true, issueDate: true, totalCents: true },
      orderBy: { issueDate: "asc" },
      take: CAP
    })
  ]);

  const hub: HubPreview[] = (previews as any[]).map((p) => ({ externalId: p.template?.externalId ?? null, period: periodOf(p.occurrenceDate), totalCents: p.totalCents }));
  const leg: LegacyInvoice[] = (legacy as any[]).map((i) => ({ legacyTemplateId: String(i.recurringSourceId), period: periodOf(i.issueDate), totalCents: i.totalCents }));

  const report = reconcile(hub, leg);
  // Si alguna fuente se truncó al tope, los datos son INCOMPLETOS: un veredicto
  // "ready" no es fiable (podría ocultar huecos/diferencias) → se degrada.
  const truncated = previews.length >= CAP || legacy.length >= CAP;
  const readiness: Readiness = truncated && report.readiness === "ready" ? "review" : report.readiness;

  return { ...report, readiness, windowMonths: months, truncated };
}
