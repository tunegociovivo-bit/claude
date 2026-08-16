/**
 * GET  /api/v1/gmb/clients/[id]/presence — Local Presence Score (0–100) + desglose + evolución +
 *      oportunidades priorizadas (reglas). ?snapshot=1 guarda un snapshot para la evolución.
 * Tenant-scoped: la ficha se valida por workspace; 404 si no es del tenant.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { computePresenceScore } from "@/lib/gmb/presence-score";
import { ensureGmbClient, gatherPresenceInput, citationStats, buildRuleOpportunities } from "@/lib/gmb/server";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");

  const input = await gatherPresenceInput(prisma, api.workspaceId, client);
  const score = computePresenceScore(input);
  const cites = await citationStats(prisma, api.workspaceId, client.id);
  const opportunities = buildRuleOpportunities(input, score.breakdown, cites).slice(0, 8);

  const history = await prisma.gmbPresenceScore.findMany({
    where: { workspaceId: api.workspaceId, clientId: client.id },
    orderBy: { recordedAt: "desc" },
    take: 12,
    select: { total: true, breakdown: true, recordedAt: true }
  });

  // ?snapshot=1 → persiste para la curva de evolución (idempotente por día: 1 por día basta).
  if (new URL(req.url).searchParams.get("snapshot") === "1") {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const already = await prisma.gmbPresenceScore.findFirst({ where: { workspaceId: api.workspaceId, clientId: client.id, recordedAt: { gte: today } } });
    if (!already) {
      await prisma.gmbPresenceScore.create({ data: { workspaceId: api.workspaceId, clientId: client.id, total: score.total, breakdown: score.breakdown } });
    }
  }

  return NextResponse.json({
    ok: true,
    clientId: client.id,
    score: score.total,
    breakdown: score.breakdown,
    weights: score.weights,
    input, // solo señales agregadas (sin PII cruda ni rawData)
    opportunities,
    history: history.reverse()
  });
});
