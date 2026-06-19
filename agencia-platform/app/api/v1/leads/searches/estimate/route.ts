/**
 * GET /api/v1/leads/searches/estimate
 *
 * Estima, ANTES de lanzar, cuántas consultas a Google hará una búsqueda y
 * cuántas se ahorrarán por la caché de barridos (#4). Sirve para mostrar el
 * coste real esperado en el modal de "Nueva búsqueda".
 *
 * Params: keyword, scope (custom|spain), location, municipality, grid (1|0),
 *         cacheDays (0 = sin caché).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { SPAIN_PROVINCES, findProvince } from "@/lib/leads/spain-provinces";
import { municipalitiesForProvince } from "@/lib/leads/spain-municipalities";

export const dynamic = "force-dynamic";

function normKey(s: string): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const u = new URL(req.url);
  const keyword = (u.searchParams.get("keyword") ?? "").trim();
  const scope = u.searchParams.get("scope") === "spain" ? "spain" : "custom";
  const location = (u.searchParams.get("location") ?? "").trim();
  const municipality = (u.searchParams.get("municipality") ?? "").trim();
  const grid = u.searchParams.get("grid") === "1";
  const cacheDays = Number(u.searchParams.get("cacheDays") ?? "0");

  // Enumera las ÁREAS con nombre (cacheables). Las celdas de grid son geo puro
  // (sin nombre) → no se cachean; las contamos aparte en el total.
  const areas: string[] = [];
  let gridTargets = 0;
  if (scope === "spain") {
    if (grid) {
      for (const p of SPAIN_PROVINCES) for (const m of municipalitiesForProvince(p.name)) areas.push(`${m}, ${p.name}`);
    } else {
      for (const p of SPAIN_PROVINCES) areas.push(p.name);
    }
  } else {
    const prov = findProvince(location);
    if (municipality) {
      if (grid) gridTargets = 49;
      else areas.push(`${municipality}, ${prov?.name ?? location}`);
    } else if (prov) {
      if (grid) gridTargets = 64;
      else for (const m of municipalitiesForProvince(prov.name)) areas.push(`${m}, ${prov.name}`);
    } else if (location) {
      areas.push(location);
    }
  }

  // Cuántas áreas ya están barridas hace < cacheDays (se saltarían).
  let cached = 0;
  if (cacheDays > 0 && keyword && areas.length) {
    const cutoff = new Date(Date.now() - cacheDays * 86400000);
    const keys = areas.map((a) => `${normKey(keyword)}|${normKey(a)}`);
    const found = new Set<string>();
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000);
      const hits = await prisma.leadQueryCache.findMany({
        where: { workspaceId: api.workspaceId, cacheKey: { in: chunk }, lastQueriedAt: { gt: cutoff } },
        select: { cacheKey: true }
      });
      for (const h of hits) found.add(h.cacheKey);
    }
    cached = found.size;
  }

  const targets = areas.length + gridTargets;
  return NextResponse.json({ targets, cached, billable: Math.max(gridTargets, targets - cached) });
});
