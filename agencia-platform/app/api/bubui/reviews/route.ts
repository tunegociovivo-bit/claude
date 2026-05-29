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

  const [reviews, agg, business] = await Promise.all([
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
    }),
    prisma.bubuiBusiness.findUnique({
      where: { id: businessId },
      select: { reviewRewardPct: true, googlePlaceId: true }
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
    canReview,
    reviewRewardPct: business?.reviewRewardPct ?? 0,
    googlePlaceId: business?.googlePlaceId ?? null
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

  // ¿Existe ya su reseña? (para decidir si toca dar recompensa o no).
  const existing = await prisma.bubuiReview.findUnique({
    where: { customerId_businessId: { customerId, businessId } },
    select: { id: true }
  });

  const cleanComment = comment?.trim() ? comment.trim() : null;
  const review = await prisma.bubuiReview.upsert({
    where: { customerId_businessId: { customerId, businessId } },
    create: { businessId, customerId, rating, comment: cleanComment },
    update: { rating, comment: cleanComment }
  });

  // Recompensa por reseña: solo en la PRIMERA reseña del cliente para ese
  // negocio y si el dueño la tiene configurada. Usamos triggerBusinessId =
  // "review:<businessId>" para reutilizar la clave única
  // (customerId, businessId, triggerBusinessId) y prevenir farmeo.
  let reward: { discountPct: number; expiresAt: Date } | null = null;
  if (!existing) {
    const business = await prisma.bubuiBusiness.findUnique({
      where: { id: businessId },
      select: { reviewRewardPct: true }
    });
    const pct = business?.reviewRewardPct ?? 0;
    if (pct > 0) {
      const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      try {
        await prisma.bubuiOffer.create({
          data: {
            customerId,
            businessId,
            discountPct: pct,
            triggerBusinessId: `review:${businessId}`,
            source: "review_reward",
            expiresAt
          }
        });
        reward = { discountPct: pct, expiresAt };
      } catch {
        // Carrera o ya existía: el cliente ya tiene la recompensa, ok silencioso.
      }
    }
  }

  return NextResponse.json({ ok: true, id: review.id, reward });
}
