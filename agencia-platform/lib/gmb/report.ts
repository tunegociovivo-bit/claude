/**
 * Informe de crecimiento — ensamblador PURO. Combina dimensiones REALES ya calculadas (score,
 * citaciones, rankings, reseñas, contenido, acciones) en una estructura para el informe mensual
 * imprimible. No inventa datos: lo que no existe queda en 0 / vacío. Sin red.
 */
export type ReportPeriod = { label: string; from: string; to: string };

export type GrowthReportInput = {
  client: { name: string; category?: string | null; address?: string | null };
  period: ReportPeriod;
  presence: { score: number; breakdown: Record<string, number> };
  citations: { total: number; published: number; inconsistent: number; notFound: number };
  rank: { keyword: string; avgPosition: number | null; top3Count: number | null; visibilityShare: number | null }[];
  reviews: { total: number; positive: number; negative: number; avgScore: number; pendingResponse: number };
  content: { published: number; scheduled: number; drafts: number };
  actions: { open: number; done: number; total: number };
};

export type GrowthReport = GrowthReportInput & { generatedAtIso: string; highlights: string[] };

/** Genera los "highlights" deterministas a partir de los datos (sin inventar). */
function buildHighlights(i: GrowthReportInput): string[] {
  const h: string[] = [];
  h.push(`Presencia local: ${i.presence.score}/100.`);
  if (i.citations.total > 0) h.push(`Citaciones: ${i.citations.published}/${i.citations.total} publicadas${i.citations.inconsistent ? `, ${i.citations.inconsistent} inconsistentes` : ""}.`);
  if (i.reviews.total > 0) h.push(`Reseñas: ${i.reviews.total} (${i.reviews.positive} positivas / ${i.reviews.negative} negativas), ${i.reviews.pendingResponse} pendientes de respuesta.`);
  const tracked = i.rank.filter((r) => r.avgPosition != null);
  if (tracked.length) h.push(`Ranking: ${tracked.length} keyword(s) medidas.`);
  else h.push("Ranking: sin mediciones en el periodo.");
  h.push(`Contenido: ${i.content.published} publicadas, ${i.content.scheduled} programadas, ${i.content.drafts} borradores.`);
  h.push(`Acciones: ${i.actions.done} completadas, ${i.actions.open} abiertas.`);
  return h;
}

export function buildGrowthReport(input: GrowthReportInput, generatedAtIso: string): GrowthReport {
  return { ...input, generatedAtIso, highlights: buildHighlights(input) };
}

/** Periodo mensual (YYYY-MM) → etiqueta + rango ISO. `monthISO` p.ej. "2026-08". */
export function monthPeriod(monthISO: string): ReportPeriod {
  const [y, m] = monthISO.split("-").map(Number);
  const from = new Date(Date.UTC(y, (m || 1) - 1, 1));
  const to = new Date(Date.UTC(y, m || 1, 0, 23, 59, 59)); // último día del mes
  const label = from.toLocaleDateString("es-ES", { month: "long", year: "numeric", timeZone: "UTC" });
  return { label, from: from.toISOString(), to: to.toISOString() };
}
