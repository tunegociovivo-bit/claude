/**
 * GET /api/v1/gmb/clients/[id]/report → datos del informe de la ficha
 * (stats, distribución, reseñas, evolución mensual). Lo consume la página
 * imprimible /gmb-hub/report/[id].
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const client = await prisma.gmbClient.findFirst({ where: { id: params.id, workspaceId: api.workspaceId } });
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");

  const reviews = await prisma.gmbReview.findMany({
    where: { clientId: params.id },
    orderBy: { reviewTime: "desc" }
  });

  const total = reviews.length;
  const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let unreplied = 0;
  let sum = 0;
  const monthlyMap = new Map<string, { count: number; sum: number }>();
  for (const r of reviews) {
    if (r.rating >= 1 && r.rating <= 5) dist[r.rating]++;
    if (!r.reviewReply) unreplied++;
    sum += r.rating;
    if (r.reviewTime) {
      const m = r.reviewTime.toISOString().slice(0, 7);
      const cur = monthlyMap.get(m) ?? { count: 0, sum: 0 };
      cur.count++;
      cur.sum += r.rating;
      monthlyMap.set(m, cur);
    }
  }
  const monthly = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, count: v.count, avg: v.count ? Number((v.sum / v.count).toFixed(1)) : 0 }));

  return NextResponse.json({
    client: {
      name: client.name,
      category: client.category,
      address: client.address,
      phone: client.phone,
      website: client.website,
      mainKeyword: client.mainKeyword
    },
    stats: {
      avg: total ? Number((sum / total).toFixed(1)) : 0,
      total,
      unreplied,
      responseRate: total ? Math.round(((total - unreplied) / total) * 100) : 0,
      distribution: dist
    },
    monthly,
    reviews: reviews.slice(0, 50).map((r) => ({
      author: r.authorName,
      rating: r.rating,
      comment: r.comment,
      reply: r.reviewReply,
      time: r.reviewTime
    })),
    generatedAt: new Date().toISOString()
  });
});
