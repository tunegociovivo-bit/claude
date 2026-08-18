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
import { resolveRankProvider } from "@/lib/gmb/rank-adapter";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");

  const [keywords, positions, config, jobs, providerReal] = await Promise.all([
    prisma.gmbKeyword.findMany({ where: { workspaceId: api.workspaceId, clientId: client.id }, orderBy: [{ isPrimary: "desc" }, { keyword: "asc" }], select: { keyword: true, isPrimary: true } }),
    prisma.gmbPosition.findMany({ where: { workspaceId: api.workspaceId, clientId: client.id }, orderBy: { checkedAt: "desc" }, take: 300, select: { keyword: true, avgPosition: true, top3Count: true, foundCount: true, cellCount: true, gridData: true, checkedAt: true } }),
    prisma.gmbRankConfig.findFirst({ where: { workspaceId: api.workspaceId, clientId: client.id } }),
    prisma.gmbRankJob.findMany({ where: { workspaceId: api.workspaceId, clientId: client.id, status: { in: ["queued", "running"] } }, select: { keyword: true, status: true } }),
    resolveRankProvider(api.workspaceId)
  ]);

  // Últimas DOS mediciones por keyword (para comparación temporal).
  const history = new Map<string, any[]>();
  for (const p of positions) { const arr = history.get(p.keyword) ?? []; if (arr.length < 2) { arr.push(p); history.set(p.keyword, arr); } }
  const runningKw = new Set(jobs.map((j: any) => j.keyword));

  const rows = keywords.map((k: any) => {
    const [p, prev] = history.get(k.keyword) ?? [];
    const stats = p ? aggregateGrid(Array.isArray(p.gridData) ? p.gridData : []) : null;
    // Delta de posición media (negativo = mejora, sube en el ranking).
    const delta = p && prev && typeof p.avgPosition === "number" && typeof prev.avgPosition === "number" ? Math.round((p.avgPosition - prev.avgPosition) * 10) / 10 : null;
    return {
      keyword: k.keyword,
      isPrimary: k.isPrimary,
      lastCheckedAt: p?.checkedAt ?? null,
      avgPosition: p?.avgPosition ?? null,
      top3Count: p?.top3Count ?? null,
      foundCount: p?.foundCount ?? null,
      cellCount: p?.cellCount ?? null,
      visibilityShare: stats?.visibilityShare ?? null,
      deltaAvgPosition: delta,
      running: runningKw.has(k.keyword)
    };
  });

  // El proveedor real puede estar configurado en Ajustes del workspace (no solo en env).
  const provider = providerReal ? { provider: "google_maps", connected: true } : rankProviderStatus();
  return NextResponse.json({ ok: true, provider, config: config ?? { centerLat: client.latitude ?? null, centerLng: client.longitude ?? null, radiusKm: 3, gridSize: 5, frequency: "manual", isDefault: true }, keywords: rows, tracked: keywords.length });
});
