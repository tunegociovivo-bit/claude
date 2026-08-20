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

const challengeImageUrlSchema = z.string().url().refine((value) => {
  const allowedBases = [
    process.env.STORAGE_PUBLIC_URL,
    process.env.NEXT_PUBLIC_BUBUI_URL,
    process.env.HUB_BASE_URL,
    "https://hub.negociovivo.app"
  ].filter((base): base is string => !!base).map((base) => base.replace(/\/+$/, ""));
  return allowedBases.some((base) => value === base || value.startsWith(`${base}/`));
}, "La imagen debe haberse subido al almacenamiento de Bubui");

const schema = z
  .object({
    description: z.string().max(500).optional().nullable(),
    businessType: z.enum(["restaurante", "comercio_producto", "servicios"]).optional(),
    bookingEnabled: z.boolean().optional(),
    address: z.string().max(200).optional().nullable(),
    // Teléfono público de contacto (botón "Llamar" en la app).
    phone: z.string().trim().max(30).optional().nullable(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    logoUrl: z.string().url().optional().nullable(),
    challengeImageUrl: challengeImageUrlSchema.optional().nullable(),
    brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
    defaultDiscountPct: z.number().int().min(3).max(MAX_DISCOUNT_PCT).optional(),
    newCustomerDiscountPct: z.number().int().min(0).max(MAX_DISCOUNT_PCT).optional(),
    crossDiscountPct: z.number().int().min(3).max(MAX_DISCOUNT_PCT).optional(),
    purchaseMode: z.enum(["double_confirm", "express"]).optional(),
    requireTicket: z.boolean().optional(),
    referralEnabled: z.boolean().optional(),
    referralReward1: z.string().max(60).optional().nullable(),
    referralReward3: z.string().max(60).optional().nullable(),
    referralReward5: z.string().max(60).optional().nullable(),
    reviewRewardPct: z.number().int().min(0).max(MAX_DISCOUNT_PCT).optional(),
    ppFollowDiscountPct: z.number().int().min(0).max(MAX_DISCOUNT_PCT).optional(),
    ppPhotoDiscountPct: z.number().int().min(0).max(MAX_DISCOUNT_PCT).optional(),
    googlePlaceId: z.string().trim().max(200).optional().nullable(),
    instagramUrl: z.string().trim().max(300).optional().nullable(),
    facebookUrl: z.string().trim().max(300).optional().nullable(),
    tiktokUrl: z.string().trim().max(300).optional().nullable(),
    trustpilotUrl: z.string().trim().max(300).optional().nullable(),
    tripadvisorUrl: z.string().trim().max(300).optional().nullable(),
    mesaReviewPlatform: z.enum(["google", "tripadvisor", "trustpilot", "instagram"]).optional(),
    reviewPushEnabled: z.boolean().optional(),
    postPurchasePushEnabled: z.boolean().optional(),
    // Oferta-reto viral (compártela con N amigos para activarla).
    shareOfferPct: z.number().int().min(0).max(MAX_DISCOUNT_PCT).optional(),
    shareOfferFriends: z.number().int().min(1).max(20).optional(),
    shareOfferLabel: z.string().trim().max(60).optional().nullable(),
    shareFriendDiscountPct: z.number().int().min(0).max(MAX_DISCOUNT_PCT).optional(),
    shareFriendLabel: z.string().trim().max(80).optional().nullable(),
    shareOfferRequiresPurchase: z.boolean().optional(),
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
    mesaBonusOnThisVisit: z.boolean().optional(),
    mesaVeteranMustContribute: z.boolean().optional(),
    mesaNewUserMustContribute: z.boolean().optional(),
    mesaVeteranShareFriends: z.number().int().min(1).max(10).optional(),
    mesaAutoAdjust: z.boolean().optional(),
    mesaActShare: z.boolean().optional(),
    mesaActReview: z.boolean().optional(),
    mesaActPhoto: z.boolean().optional(),
    mesaActFollow: z.boolean().optional(),
    mesaPerkLabel: z.string().trim().max(80).optional().nullable(),
    // Preferencias de push del panel del dueño.
    pushOnNewClient: z.boolean().optional(),
    pushOnReview: z.boolean().optional(),
    pushOnBooking: z.boolean().optional(),
    pushOnCoupon: z.boolean().optional()
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
  if (data.description === "") data.description = null;
  if (data.address === "") data.address = null;
  if (data.phone === "") data.phone = null;
  if (data.googlePlaceId === "") data.googlePlaceId = null;
  for (const k of ["instagramUrl", "facebookUrl", "tiktokUrl", "trustpilotUrl", "tripadvisorUrl"] as const) {
    if ((data as any)[k] === "") (data as any)[k] = null;
  }
  if (data.loyaltyRewardLabel === "") data.loyaltyRewardLabel = null;
  if (data.birthdayMessage === "") data.birthdayMessage = null;
  if (data.shareOfferLabel === "") data.shareOfferLabel = null;
  if (data.shareFriendLabel === "") data.shareFriendLabel = null;
  if (data.mesaPerkLabel === "") data.mesaPerkLabel = null;
  // Garantía: ruleta min <= max.
  if (data.wheelMinPct != null && data.wheelMaxPct != null && data.wheelMinPct > data.wheelMaxPct) {
    return NextResponse.json(
      { error: { code: "validation", message: "El mínimo de la ruleta no puede ser mayor que el máximo" } },
      { status: 400 }
    );
  }

  // La Mesa Colectiva es solo de restaurantes: si el negocio cambia a otro
  // tipo, apagamos el flag para que no quede huérfano a true en BD (el panel
  // oculta el interruptor para no-restaurantes y no podría desactivarse).
  if (data.businessType && data.businessType !== "restaurante") {
    data.mesaEnabled = false;
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
      challengeImageUrl: updated.challengeImageUrl,
      brandColor: updated.brandColor,
      defaultDiscountPct: updated.defaultDiscountPct,
      crossDiscountPct: updated.crossDiscountPct,
      purchaseMode: updated.purchaseMode
    }
  });
}
