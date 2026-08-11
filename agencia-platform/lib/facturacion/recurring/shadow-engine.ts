/**
 * Motor recurrente NATIVO en modo SHADOW (Slice C). Calcula las próximas
 * ocurrencias debidas de cada plantilla y persiste PREVIEWS idempotentes de lo que
 * se emitiría — SIN crear facturas reales, SIN número legal, SIN emitir/enviar/
 * cobrar, SIN tocar el motor legado ni avanzar la plantilla.
 *
 * Anti doble-factura: `@@unique([workspaceId, templateId, occurrenceDate])` →
 * repetir la ejecución no duplica (P2002 → skip). Esa unicidad ES el lock lógico.
 */
import { dueOccurrences, nextOccurrence, occurrenceKey, type RecurrenceSpec } from "./occurrences";

type PrismaLike = any;

const TEMPLATE_SELECT = {
  id: true,
  workspaceId: true,
  status: true,
  currency: true,
  paymentMethod: true,
  series: true,
  lines: true,
  subtotalCents: true,
  taxCents: true,
  totalCents: true,
  issuerSnapshot: true,
  clientSnapshot: true,
  intervalMonths: true,
  dayOfMonth: true,
  anchorDate: true,
  startDate: true,
  endDate: true,
  nextIssueAt: true
};

function specOf(t: any): RecurrenceSpec | null {
  const anchor = t.anchorDate ?? t.startDate ?? t.nextIssueAt;
  if (!anchor) return null; // sin fecha base no se puede calcular
  return {
    anchorDate: new Date(anchor),
    intervalMonths: Math.max(1, Math.floor(Number(t.intervalMonths) || 1)),
    dayOfMonth: t.dayOfMonth != null ? Number(t.dayOfMonth) : null,
    startDate: t.startDate ? new Date(t.startDate) : null,
    endDate: t.endDate ? new Date(t.endDate) : null,
    nextIssueAt: t.nextIssueAt ? new Date(t.nextIssueAt) : null
  };
}

export type ShadowRunResult = {
  templatesConsidered: number;
  previewsCreated: number;
  previewsSkipped: number; // ya existían (idempotente / anti doble-factura)
  // Alguna plantilla superó el cap de catch-up (cursor muy atrasado). El shadow NO
  // avanza el cursor, así que solo se materializan las primeras `cap` ocurrencias;
  // se SEÑALA para no ocultar que faltan periodos (antes del corte hay que avanzar
  // el cursor). truncatedTemplateIds lista cuáles.
  truncated: boolean;
  truncatedTemplateIds: string[];
  errors: { templateId: string; error: string }[];
};

/**
 * Ejecuta el motor en SHADOW para un workspace. Solo plantillas `active`/`draft`
 * (las pausadas/archivadas no generan). Catch-up ACOTADO (dueOccurrences cap).
 */
export async function runShadow(prisma: PrismaLike, workspaceId: string, now = new Date(), cap = 12): Promise<ShadowRunResult> {
  const templates = await prisma.recurringInvoiceTemplate.findMany({
    where: { workspaceId, status: { in: ["active", "draft"] } },
    select: TEMPLATE_SELECT
  });
  const res: ShadowRunResult = { templatesConsidered: templates.length, previewsCreated: 0, previewsSkipped: 0, truncated: false, truncatedTemplateIds: [], errors: [] };

  for (const t of templates) {
    const spec = specOf(t);
    if (!spec) continue;
    let due: Date[];
    try {
      due = dueOccurrences(spec, now, cap);
    } catch (e: any) {
      res.errors.push({ templateId: t.id, error: `cálculo: ${String(e?.message ?? e).slice(0, 120)}` });
      continue;
    }
    if (due.length >= cap) {
      res.truncated = true;
      res.truncatedTemplateIds.push(t.id);
    }
    for (const occ of due) {
      const key = `${t.id}:${occurrenceKey(occ)}`;
      try {
        // findFirst + create idempotente (la unicidad es el guard anti doble-factura).
        const existing = await prisma.recurringInvoicePreview.findFirst({
          where: { workspaceId, templateId: t.id, occurrenceDate: occ },
          select: { id: true }
        });
        if (existing) {
          res.previewsSkipped++;
          continue;
        }
        await prisma.recurringInvoicePreview.create({
          data: {
            workspaceId,
            templateId: t.id,
            occurrenceDate: occ,
            idempotencyKey: key,
            status: "preview",
            currency: t.currency,
            subtotalCents: t.subtotalCents,
            taxCents: t.taxCents,
            totalCents: t.totalCents,
            payload: {
              templateId: t.id,
              occurrenceDate: occurrenceKey(occ),
              series: t.series ?? null,
              paymentMethod: t.paymentMethod,
              issuerSnapshot: t.issuerSnapshot ?? null,
              clientSnapshot: t.clientSnapshot ?? null,
              lines: t.lines ?? []
            }
          }
        });
        res.previewsCreated++;
      } catch (e: any) {
        if (e?.code === "P2002") res.previewsSkipped++; // carrera concurrente → idempotente
        else res.errors.push({ templateId: t.id, error: String(e?.message ?? e).slice(0, 120) });
      }
    }
  }
  return res;
}

export type PreviewListItem = {
  id: string;
  templateId: string;
  occurrenceDate: string;
  totalCents: number;
  currency: string;
  status: string;
};

/** Lista previews (opcionalmente de una plantilla) + la próxima ocurrencia estimada. */
export async function listPreviews(prisma: PrismaLike, workspaceId: string, templateId?: string): Promise<{ items: PreviewListItem[]; total: number }> {
  const where: any = { workspaceId };
  if (templateId) where.templateId = templateId;
  const rows = await prisma.recurringInvoicePreview.findMany({
    where,
    orderBy: { occurrenceDate: "desc" },
    take: 500,
    select: { id: true, templateId: true, occurrenceDate: true, totalCents: true, currency: true, status: true }
  });
  return {
    total: rows.length,
    items: rows.map((r: any) => ({ id: r.id, templateId: r.templateId, occurrenceDate: new Date(r.occurrenceDate).toISOString().slice(0, 10), totalCents: r.totalCents, currency: r.currency, status: r.status }))
  };
}

export { nextOccurrence };
