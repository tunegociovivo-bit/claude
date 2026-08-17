/**
 * Portfolio multi-ficha (vista de agencia) — helpers PUROS de fila, filtro, orden y búsqueda. Sin
 * red. La agregación real (tenant-scoped) la hace la API; aquí solo se transforma/ordena/filtra.
 */
export type PortfolioRow = {
  clientId: string;
  name: string;
  category: string;
  score: number | null;
  unreplied: number;
  brokenCitations: number;
  rankingDrop: number;
  contentStaleDays: number | null;
  connectionOk: boolean;
  openAlerts: number;
  criticalAlerts: number;
};

export type PortfolioFilter = { search?: string; onlyAlerts?: boolean; onlyCritical?: boolean; maxScore?: number };
export type PortfolioSortKey = "name" | "score" | "alerts" | "unreplied" | "citations";

const norm = (s: string) => (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function filterPortfolio(rows: PortfolioRow[], f: PortfolioFilter): PortfolioRow[] {
  const q = norm(f.search ?? "");
  return rows.filter((r) => {
    if (q && !norm(r.name).includes(q) && !norm(r.category).includes(q)) return false;
    if (f.onlyAlerts && r.openAlerts <= 0) return false;
    if (f.onlyCritical && r.criticalAlerts <= 0) return false;
    if (f.maxScore != null && (r.score ?? 0) > f.maxScore) return false;
    return true;
  });
}

export function sortPortfolio(rows: PortfolioRow[], key: PortfolioSortKey, dir: "asc" | "desc" = "asc"): PortfolioRow[] {
  const mul = dir === "asc" ? 1 : -1;
  const val = (r: PortfolioRow): number | string => {
    switch (key) {
      case "name": return norm(r.name);
      case "score": return r.score ?? -1;
      case "alerts": return r.openAlerts;
      case "unreplied": return r.unreplied;
      case "citations": return r.brokenCitations;
    }
  };
  return [...rows].sort((a, b) => {
    const va = val(a), vb = val(b);
    if (typeof va === "string" || typeof vb === "string") return String(va).localeCompare(String(vb)) * mul;
    return (va - vb) * mul;
  });
}

/** Totales del portfolio para las tarjetas KPI de cabecera. */
export function portfolioTotals(rows: PortfolioRow[]): { clients: number; avgScore: number; openAlerts: number; critical: number; unreplied: number; brokenCitations: number } {
  const scored = rows.filter((r) => typeof r.score === "number");
  return {
    clients: rows.length,
    avgScore: scored.length ? Math.round(scored.reduce((s, r) => s + (r.score ?? 0), 0) / scored.length) : 0,
    openAlerts: rows.reduce((s, r) => s + r.openAlerts, 0),
    critical: rows.reduce((s, r) => s + r.criticalAlerts, 0),
    unreplied: rows.reduce((s, r) => s + r.unreplied, 0),
    brokenCitations: rows.reduce((s, r) => s + r.brokenCitations, 0)
  };
}
