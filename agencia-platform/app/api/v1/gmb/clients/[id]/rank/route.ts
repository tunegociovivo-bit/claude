/**
 * GET /api/v1/gmb/clients/[id]/rank — estado del Rank Grid: keywords rastreadas, última medición por
 * keyword (GmbPosition) agregada, y estado HONESTO del proveedor (Google Maps). Sin credenciales →
 * connected:false y sin posiciones fabricadas. La medición real la dispara el endpoint grid-rank.
 * Tenant-scoped.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ensureGmbClient } from "@/lib/gmb/server";
import { rankProviderStatus, aggregateGrid } from "@/lib/gmb/rank";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");

  const [keywords, positions] = await Promise.all([
    prisma.gmbKeyword.findMany({ where: { workspaceId: api.workspaceId, clientId: client.id }, orderBy: [{ isPrimary: "desc" }, { keyword: "asc" }], select: { keyword: true, isPrimary: true } }),
    prisma.gmbPosition.findMany({ where: { workspaceId: api.workspaceId, clientId: client.id }, orderBy: { checkedAt: "desc" }, take: 200, select: { keyword: true, avgPosition: true, top3Count: true, foundCount: true, cellCount: true, gridData: true, checkedAt: true } })
  ]);

  // Última medición por keyword.
  const latest = new Map<string, any>();
  for (const p of positions) if (!latest.has(p.keyword)) latest.set(p.keyword, p);

  const rows = keywords.map((k: any) => {
    const p = latest.get(k.keyword);
    const stats = p ? aggregateGrid(Array.isArray(p.gridData) ? p.gridData : []) : null;
    return {
      keyword: k.keyword,
      isPrimary: k.isPrimary,
      lastCheckedAt: p?.checkedAt ?? null,
      avgPosition: p?.avgPosition ?? null,
      top3Count: p?.top3Count ?? null,
      foundCount: p?.foundCount ?? null,
      cellCount: p?.cellCount ?? null,
      visibilityShare: stats?.visibilityShare ?? null
    };
  });

  return NextResponse.json({ ok: true, provider: rankProviderStatus(), keywords: rows, tracked: keywords.length });
});
