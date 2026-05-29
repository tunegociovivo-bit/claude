/**
 * Reseñas de negocios Bubui.
 *
 * GET  /api/bubui/reviews?businessId=...&customerId=...
 *   → { count, average, reviews: [...], mine: {rating,comment}|null }
 *
 * POST /api/bubui/reviews  { businessId, customerId, rating(1-5), comment? }
 *   → crea o actualiza la reseña del cliente. Solo se permite si el cliente
 *     tiene al menos UNA compra confirmada en ese negocio (anti-fake). Una
 *     reseña por cliente y negocio (se actualiza al reenviar).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const businessId = url.searchParams.get("businessId");
  const customerId = url.searchParams.get("customerId");
  if (!businessId) {
    return NextResponse.json({ error: { code: "validation", message: "Falta businessId" } }, { status: 400 });
  }

  const [reviews, agg] = await Promise.all([
    prisma.bubuiReview.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { customer: { select: { name: true } } }
    }),
    prisma.bubuiReview.aggregate({
      where: { businessId },
      _avg: { rating: true },
      _count: true
    })
  ]);

  const mine = customerId
    ? await prisma.bubuiReview.findUnique({
        where: { customerId_businessId: { customerId, businessId } },
        select: { rating: true, comment: true }
      })
    : null;

  // ¿Puede reseñar? (tiene compra confirmada y aún no ha reseñado)
  let canReview = false;
  if (customerId) {
    const confirmed = await prisma.bubuiPurchase.count({
      where: { customerId, businessId, status: "confirmed" }
    });
    canReview = confirmed > 0;
  }

  return NextResponse.json({
    count: agg._count,
    average: agg._avg.rating ? Math.round(agg._avg.rating * 10) / 10 : null,
    reviews: reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      author: r.customer?.name || "Cliente Bubui",
      createdAt: r.createdAt
    })),
    mine,
    canReview
  });
}

const postSchema = z.object({
  businessId: z.string().min(1),
  customerId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(600).optional()
});

export async function POST(req: Request) {
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation", message: parsed.error.issues[0]?.message ?? "Datos no válidos" } },
      { status: 400 }
    );
  }
  const { businessId, customerId, rating, comment } = parsed.data;

  // Anti-fake: exige al menos una compra confirmada del cliente en el negocio.
  const confirmed = await prisma.bubuiPurchase.count({
    where: { customerId, businessId, status: "confirmed" }
  });
  if (confirmed === 0) {
    return NextResponse.json(
      { error: { code: "not_customer", message: "Solo puedes valorar negocios donde has comprado." } },
      { status: 403 }
    );
  }

  const cleanComment = comment?.trim() ? comment.trim() : null;
  const review = await prisma.bubuiReview.upsert({
    where: { customerId_businessId: { customerId, businessId } },
    create: { businessId, customerId, rating, comment: cleanComment },
    update: { rating, comment: cleanComment }
  });

  return NextResponse.json({ ok: true, id: review.id });
}
