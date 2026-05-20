/**
 * GET /api/v1/gmb/widget/[id]  (PÚBLICO)
 * Datos de reseñas para el widget embebible en la web del cliente.
 * Expone solo info pública (las reseñas ya son públicas en Google).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { rateLimitPublic } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = rateLimitPublic(req, { tag: "gmb-widget", limit: 120 });
  if (limited) return limited;

  const client = await prisma.gmbClient.findUnique({
    where: { id: params.id },
    select: { name: true, rating: true, reviewCount: true, placeId: true }
  });
  if (!client) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const reviews = await prisma.gmbReview.findMany({
    where: { clientId: params.id, NOT: { comment: null } },
    orderBy: { reviewTime: "desc" },
    take: 12,
    select: { authorName: true, authorPhoto: true, rating: true, comment: true, reviewTime: true }
  });

  const res = NextResponse.json({
    name: client.name,
    rating: client.rating,
    reviewCount: client.reviewCount,
    placeId: client.placeId,
    reviews: reviews.map((r) => ({
      author: r.authorName,
      photo: r.authorPhoto,
      rating: r.rating,
      comment: r.comment,
      time: r.reviewTime
    }))
  });
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Cache-Control", "public, max-age=300");
  return res;
}
