/** GET /api/v1/gmb/dashboard → KPIs globales de GMB Hub */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const ws = api.workspaceId;
  const [total, active, paused, reviewAgg, dist, recent, topClients] = await Promise.all([
    prisma.gmbClient.count({ where: { workspaceId: ws } }),
    prisma.gmbClient.count({ where: { workspaceId: ws, status: "active" } }),
    prisma.gmbClient.count({ where: { workspaceId: ws, status: "paused" } }),
    prisma.gmbReview.aggregate({ where: { workspaceId: ws }, _avg: { rating: true }, _count: { _all: true } }),
    prisma.gmbReview.groupBy({ by: ["rating"], where: { workspaceId: ws }, _count: { _all: true } }),
    prisma.gmbActivity.findMany({
      where: { workspaceId: ws },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { client: { select: { name: true } } }
    }),
    prisma.gmbClient.findMany({
      where: { workspaceId: ws },
      orderBy: [{ reviewCount: "desc" }],
      take: 5,
      select: { id: true, name: true, rating: true, reviewCount: true }
    })
  ]);

  const distribution: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  for (const d of dist) if (d.rating >= 1 && d.rating <= 5) distribution[String(d.rating)] = d._count._all;

  // Reseñas sin responder (global)
  const unreplied = await prisma.gmbReview.count({
    where: { workspaceId: ws, OR: [{ reviewReply: null }, { reviewReply: "" }] }
  });

  return NextResponse.json({
    totals: {
      clients: total,
      active,
      paused,
      reviews: reviewAgg._count._all,
      averageRating: Number((reviewAgg._avg.rating ?? 0).toFixed(1)),
      unreplied
    },
    distribution,
    topClients,
    recentActivity: recent.map((a) => ({
      id: a.id,
      actionType: a.actionType,
      description: a.description,
      client: a.client?.name ?? null,
      createdAt: a.createdAt
    }))
  });
});
