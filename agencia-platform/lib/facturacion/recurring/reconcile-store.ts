/**
 * Readiness / reconciliación (Slice E0) — SOLO LECTURA. Trae los previews shadow
 * del Hub y las facturas ya generadas por el legado (recientes), y los reconcilia.
 * NO escribe nada, NO activa, NO congela Holded, NO emite. Tenant SIEMPRE.
 */
import { reconcile, periodOf, type HubPreview, type LegacyInvoice, type ReconciliationReport } from "./reconcile";

type PrismaLike = any;
const MONTH = 30 * 86_400_000;

export async function readinessReport(prisma: PrismaLike, workspaceId: string, now = new Date(), months = 6): Promise<ReconciliationReport & { windowMonths: number }> {
  const since = new Date(now.getTime() - months * MONTH);

  const [previews, legacy] = await Promise.all([
    prisma.recurringInvoicePreview.findMany({
      where: { workspaceId, occurrenceDate: { gte: since } },
      select: { occurrenceDate: true, totalCents: true, template: { select: { externalId: true } } },
      take: 5000
    }),
    // Facturas REALES generadas por el motor legado (recurringSourceId != null).
    prisma.invoice.findMany({
      where: { workspaceId, deletedAt: null, recurringSourceId: { not: null }, issueDate: { gte: since } },
      select: { recurringSourceId: true, issueDate: true, totalCents: true },
      take: 5000
    })
  ]);

  const hub: HubPreview[] = (previews as any[]).map((p) => ({ externalId: p.template?.externalId ?? null, period: periodOf(p.occurrenceDate), totalCents: p.totalCents }));
  const leg: LegacyInvoice[] = (legacy as any[]).map((i) => ({ legacyTemplateId: String(i.recurringSourceId), period: periodOf(i.issueDate), totalCents: i.totalCents }));

  return { ...reconcile(hub, leg), windowMonths: months };
}
