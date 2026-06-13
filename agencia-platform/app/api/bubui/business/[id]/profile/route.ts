/**
 * PATCH /api/bubui/business/[id]/profile
 *
 * Permite al dueño del negocio editar campos del perfil que afectan a la
 * página pública y al cartel. Auth simple v1: header
 * `Authorization: Bearer <businessId>:<random>` que se guarda en
 * localStorage tras login. v1 confiamos en que el token contiene el id —
 * en v2 firmamos JWT.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

// Tope global de descuento por compra (protege el margen del negocio).
const MAX_DISCOUNT_PCT = 50;

const schema = z
  .object({
    description: z.string().max(500).optional(),
    address: z.string().max(200).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    logoUrl: z.string().url().optional().nullable(),
    brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
    defaultDiscountPct: z.number().int().min(3).max(MAX_DISCOUNT_PCT).optional(),
    crossDiscountPct: z.number().int().min(3).max(MAX_DISCOUNT_PCT).optional(),
    purchaseMode: z.enum(["double_confirm", "express"]).optional(),
    requireTicket: z.boolean().optional(),
    referralEnabled: z.boolean().optional(),
    referralReward1: z.string().max(60).optional().nullable(),
    referralReward3: z.string().max(60).optional().nullable(),
    referralReward5: z.string().max(60).optional().nullable(),
    reviewRewardPct: z.number().int().min(0).max(MAX_DISCOUNT_PCT).optional(),
    googlePlaceId: z.string().trim().max(200).optional().nullable(),
    reviewPushEnabled: z.boolean().optional(),
    // Oferta-reto viral (compártela con N amigos para activarla).
    shareOfferPct: z.number().int().min(0).max(MAX_DISCOUNT_PCT).optional(),
    shareOfferFriends: z.number().int().min(1).max(20).optional(),
    shareOfferLabel: z.string().trim().max(60).optional().nullable(),
    loyaltyEnabled: z.boolean().optional(),
    loyaltyGoal: z.number().int().min(2).max(20).optional(),
    loyaltyRewardPct: z.number().int().min(0).max(MAX_DISCOUNT_PCT).optional(),
    loyaltyRewardLabel: z.string().trim().max(60).optional().nullable(),
    birthdayEnabled: z.boolean().optional(),
    birthdayDiscountPct: z.number().int().min(3).max(MAX_DISCOUNT_PCT).optional(),
    birthdayMessage: z.string().trim().max(300).optional().nullable(),
    wheelEnabled: z.boolean().optional(),
    wheelMinPct: z.number().int().min(0).max(MAX_DISCOUNT_PCT).optional(),
    wheelMaxPct: z.number().int().min(0).max(MAX_DISCOUNT_PCT).optional(),
    // Mesa Colectiva (restauración).
    mesaEnabled: z.boolean().optional(),
    mesaBasePct: z.number().int().min(0).max(MAX_DISCOUNT_PCT).optional(),
    mesaMinDiners: z.number().int().min(2).max(50).optional(),
    mesaShareBonusPct: z.number().int().min(0).max(MAX_DISCOUNT_PCT).optional(),
    mesaShareFriends: z.number().int().min(1).max(10).optional(),
    mesaReviewBonusPct: z.number().int().min(0).max(MAX_DISCOUNT_PCT).optional(),
    mesaMaxPct: z.number().int().min(0).max(MAX_DISCOUNT_PCT).optional(),
    mesaJoinWindowMin: z.number().int().min(5).max(180).optional(),
    mesaNextVisitDays: z.number().int().min(1).max(120).optional(),
    mesaBonusOnThisVisit: z.boolean().optional()
  })
  // La ruleta no puede tener el mínimo por encima del máximo.
  .refine(
    (d) => d.wheelMinPct == null || d.wheelMaxPct == null || d.wheelMinPct <= d.wheelMaxPct,
    { message: "El mínimo de la ruleta no puede ser mayor que el máximo", path: ["wheelMinPct"] }
  );

function tokenAllows(token: string | null, businessId: string): boolean {
  if (!token) return false;
  const m = /^Bearer\s+([\w-]+):/.exec(token);
  return !!m && m[1] === businessId;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = req.headers.get("authorization");
  if (!tokenAllows(auth, params.id)) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation", message: parsed.error.message } }, { status: 400 });
  }
  // Normaliza strings vacíos a null para limpiar el dato.
  const data = { ...parsed.data };
  if (data.googlePlaceId === "") data.googlePlaceId = null;
  if (data.loyaltyRewardLabel === "") data.loyaltyRewardLabel = null;
  if (data.birthdayMessage === "") data.birthdayMessage = null;
  if (data.shareOfferLabel === "") data.shareOfferLabel = null;
  // Garantía: ruleta min <= max.
  if (data.wheelMinPct != null && data.wheelMaxPct != null && data.wheelMinPct > data.wheelMaxPct) {
    return NextResponse.json(
      { error: { code: "validation", message: "El mínimo de la ruleta no puede ser mayor que el máximo" } },
      { status: 400 }
    );
  }

  const updated = await prisma.bubuiBusiness.update({
    where: { id: params.id },
    data
  });
  return NextResponse.json({
    ok: true,
    business: {
      id: updated.id,
      slug: updated.slug,
      description: updated.description,
      address: updated.address,
      latitude: updated.latitude,
      longitude: updated.longitude,
      logoUrl: updated.logoUrl,
      brandColor: updated.brandColor,
      defaultDiscountPct: updated.defaultDiscountPct,
      crossDiscountPct: updated.crossDiscountPct,
      purchaseMode: updated.purchaseMode
    }
  });
}
