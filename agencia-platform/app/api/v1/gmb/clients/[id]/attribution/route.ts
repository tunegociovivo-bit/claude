/**
 * GET /api/v1/gmb/clients/[id]/attribution?month=YYYY-MM — atribución/ROI: eventos REALES agregados
 * por tipo/fuente/campaña, comparación con el periodo anterior, progreso de objetivos y campañas.
 * Nunca inventa conversiones. Tenant-scoped. Estado vacío honesto (0 eventos si no hay tracking).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ensureGmbClient } from "@/lib/gmb/server";
import { aggregateEvents, goalProgress } from "@/lib/gmb/attribution";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");

  const monthParam = new URL(req.url).searchParams.get("month");
  const now = new Date();
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const [y, m] = month.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1)), to = new Date(Date.UTC(y, m, 0, 23, 59, 59));
  const prevFrom = new Date(Date.UTC(y, m - 2, 1)), prevTo = new Date(Date.UTC(y, m - 1, 0, 23, 59, 59));

  const [events, goals, campaigns] = await Promise.all([
    prisma.gmbAttributionEvent.findMany({ where: { workspaceId: api.workspaceId, clientId: client.id, occurredAt: { gte: prevFrom, lte: to } }, select: { type: true, source: true, campaign: true, occurredAt: true }, take: 5000 }),
    prisma.gmbGoal.findMany({ where: { workspaceId: api.workspaceId, clientId: client.id } }),
    prisma.gmbCampaign.findMany({ where: { workspaceId: api.workspaceId, clientId: client.id }, orderBy: { startDate: "desc" }, take: 50, select: { id: true, name: true, channel: true, startDate: true, note: true, active: true } })
  ]);

  const agg = aggregateEvents(events as any, from, to, prevFrom, prevTo);
  const progress = goalProgress(agg.current, goals.map((g: any) => ({ metric: g.metric, target: g.target })));
  // Anotaciones de campaña (marcadores en el periodo).
  const annotations = campaigns.filter((c: any) => c.startDate).map((c: any) => ({ date: c.startDate, label: c.name, channel: c.channel }));

  return NextResponse.json({ ok: true, month, period: { from, to }, aggregate: agg, goals: progress, campaigns, annotations, hasData: agg.total > 0 });
});
