/**
 * POST /api/bipi/scan
 *
 * El cliente escanea el QR del negocio e introduce el importe. Crea una
 * compra en estado `pending` y notifica al panel del negocio para que
 * confirme. Aplica anti-fraude geográfico:
 *   - si el cliente envía sus coords y están a >200m del negocio, marca
 *     la compra como rechazada con motivo "geo_mismatch" — el cliente
 *     posiblemente escaneó una foto del QR.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  haversineMeters,
  unlockOffersForPurchase,
  recalculateVisibilityScore,
  recalculateAmbassadorLevel
} from "@/lib/bipi/core";

export const dynamic = "force-dynamic";

const schema = z.object({
  businessId: z.string().min(1),
  customerId: z.string().min(1),
  amount: z.number().positive().max(10000),
  scanLat: z.number().optional(),
  scanLng: z.number().optional()
});

const MAX_DISTANCE_METERS = 200;

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation", message: parsed.error.message } }, { status: 400 });
  }
  const d = parsed.data;

  const [business, customer] = await Promise.all([
    prisma.bipiBusiness.findUnique({ where: { id: d.businessId } }),
    prisma.bipiCustomer.findUnique({ where: { id: d.customerId } })
  ]);
  if (!business) return NextResponse.json({ error: { code: "not_found", message: "Negocio no existe" } }, { status: 404 });
  if (!business.active) return NextResponse.json({ error: { code: "inactive", message: "Negocio inactivo" } }, { status: 409 });
  if (!customer) return NextResponse.json({ error: { code: "not_found", message: "Cliente no existe" } }, { status: 404 });

  // Rate limit: máx 1 escaneo cliente-negocio cada 12h.
  const recent = await prisma.bipiPurchase.findFirst({
    where: {
      customerId: d.customerId,
      businessId: d.businessId,
      scannedAt: { gte: new Date(Date.now() - 12 * 60 * 60 * 1000) }
    }
  });
  if (recent) {
    return NextResponse.json(
      { error: { code: "rate_limit", message: "Ya escaneaste este negocio en las últimas 12h" } },
      { status: 429 }
    );
  }

  // ¿Hay una oferta canjeable de este cliente para este negocio?
  const now = new Date();
  const activeOffer = await prisma.bipiOffer.findFirst({
    where: {
      customerId: d.customerId,
      businessId: d.businessId,
      expiresAt: { gt: now },
      redeemed: false
    },
    orderBy: { discountPct: "desc" }
  });

  const discountPct = activeOffer?.discountPct ?? business.defaultDiscountPct;
  const discountAmount = Math.round(d.amount * discountPct) / 100;

  // Geo-check anti-fraude.
  let scanDistanceM: number | undefined;
  let autoReject = false;
  if (
    d.scanLat != null &&
    d.scanLng != null &&
    business.latitude != null &&
    business.longitude != null
  ) {
    scanDistanceM = haversineMeters(d.scanLat, d.scanLng, business.latitude, business.longitude);
    if (scanDistanceM > MAX_DISTANCE_METERS) {
      autoReject = true;
    }
  }

  const purchase = await prisma.bipiPurchase.create({
    data: {
      customerId: d.customerId,
      businessId: d.businessId,
      amount: d.amount,
      discountPct,
      discountAmount,
      status: autoReject ? "rejected" : "confirmed",
      confirmedAt: autoReject ? undefined : new Date(),
      redeemedOfferId: activeOffer?.id,
      scanLat: d.scanLat,
      scanLng: d.scanLng,
      scanDistanceM,
      rejectionReason: autoReject
        ? `Escaneo a ${Math.round(scanDistanceM!)}m del local (máx ${MAX_DISTANCE_METERS}m)`
        : undefined
    }
  });

  let offersUnlocked = 0;
  if (!autoReject) {
    // Registro inmediato del ahorro (sin confirmación del negocio):
    // marca cupón canjeado, suma ahorro al cliente y desbloquea cercanos.
    if (activeOffer) {
      await prisma.bipiOffer.update({
        where: { id: activeOffer.id },
        data: { redeemed: true, redeemedAt: new Date() }
      }).catch(() => {});
    }
    await prisma.bipiCustomer.update({
      where: { id: d.customerId },
      data: { totalPurchases: { increment: 1 }, totalSaved: { increment: discountAmount } }
    });
    const res = await unlockOffersForPurchase({
      customerId: d.customerId,
      triggerBusinessId: d.businessId,
      triggerCategory: business.category,
      triggerLat: business.latitude,
      triggerLng: business.longitude
    });
    offersUnlocked = res.created;
    void recalculateVisibilityScore(d.businessId).catch(() => {});
    void recalculateAmbassadorLevel(d.customerId).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    purchaseId: purchase.id,
    status: purchase.status,
    discountPct,
    discountAmount,
    offersUnlocked,
    business: { id: business.id, name: business.name, category: business.category },
    rejectionReason: purchase.rejectionReason,
    offerRedeemed: !!activeOffer
  });
}
