/**
 * GET /api/v1/gmb/portfolio — vista de agencia: todas las fichas del workspace con score, reseñas sin
 * responder, citaciones rotas, caída de ranking, contenido vencido, estado de conexión y alertas.
 * Filtros/orden/búsqueda por query. Tenant-scoped. Solo datos reales.
 *   ?search= &sort=name|score|alerts|unreplied|citations &dir=asc|desc &onlyAlerts=1 &onlyCritical=1
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { portfolioRows } from "@/lib/gmb/agency-data";
import { filterPortfolio, sortPortfolio, portfolioTotals, type PortfolioSortKey } from "@/lib/gmb/portfolio";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const url = new URL(req.url);
  const rows = await portfolioRows(prisma, api.workspaceId);
  const filtered = filterPortfolio(rows, {
    search: url.searchParams.get("search") ?? undefined,
    onlyAlerts: url.searchParams.get("onlyAlerts") === "1",
    onlyCritical: url.searchParams.get("onlyCritical") === "1"
  });
  const sortKey = (url.searchParams.get("sort") as PortfolioSortKey) || "alerts";
  const dir = url.searchParams.get("dir") === "asc" ? "asc" : "desc";
  const sorted = sortPortfolio(filtered, ["name", "score", "alerts", "unreplied", "citations"].includes(sortKey) ? sortKey : "alerts", dir);
  return NextResponse.json({ ok: true, totals: portfolioTotals(rows), rows: sorted, count: sorted.length });
});
