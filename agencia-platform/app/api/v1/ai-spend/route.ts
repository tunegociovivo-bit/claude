/**
 * GET /api/v1/ai-spend
 *
 * Gasto en IA del workspace: total del MES en curso y total de HOY.
 * Suma AiUsage.costMicros (micros de USD). Para el indicador del tablero.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [month, today] = await Promise.all([
    prisma.aiUsage.aggregate({
      where: { workspaceId: api.workspaceId, createdAt: { gte: monthStart } },
      _sum: { costMicros: true }
    }),
    prisma.aiUsage.aggregate({
      where: { workspaceId: api.workspaceId, createdAt: { gte: dayStart } },
      _sum: { costMicros: true }
    })
  ]);

  return NextResponse.json({
    monthMicros: month._sum.costMicros ?? 0,
    todayMicros: today._sum.costMicros ?? 0
  });
});
