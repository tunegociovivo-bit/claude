/** GET /api/v1/gmb/clients/[id]/reviews → reseñas de la ficha (máx 200, recientes primero) */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { params, api }) => {
  const client = await prisma.gmbClient.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: { id: true, name: true, rating: true, reviewCount: true }
  });
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");

  const url = new URL(req.url);
  const onlyUnreplied = url.searchParams.get("unreplied") === "1";

  const reviews = await prisma.gmbReview.findMany({
    where: {
      clientId: client.id,
      ...(onlyUnreplied ? { OR: [{ reviewReply: null }, { reviewReply: "" }] } : {})
    },
    orderBy: { reviewTime: "desc" },
    take: 200
  });

  const agg = await prisma.gmbReview.aggregate({
    where: { clientId: client.id },
    _avg: { rating: true },
    _count: { _all: true }
  });

  return NextResponse.json({
    client: { id: client.id, name: client.name },
    averageRating: Number((agg._avg.rating ?? 0).toFixed(1)),
    totalReviewCount: agg._count._all,
    reviews: reviews.map((r) => ({
      id: r.id,
      reviewId: r.reviewId,
      authorName: r.authorName,
      authorPhoto: r.authorPhoto,
      rating: r.rating,
      comment: r.comment,
      reviewReply: r.reviewReply,
      reviewTime: r.reviewTime,
      updateTime: r.updateTime
    }))
  });
});
