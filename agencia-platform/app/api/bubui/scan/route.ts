/**
 * POST /api/bubui/scan
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
} from "@/lib/bubui/core";
import { customerAuthOk } from "@/lib/bubui/customer-auth";

export const dynamic = "force-dynamic";

const schema = z.object({
  businessId: z.string().min(1),
  customerId: z.string().min(1),
  amount: z.number().positive().max(10000),
  scanLat: z.number().optional(),
  scanLng: z.number().optional(),
  ticketUrl: z.string().url().max(2000).optional(),
  // Anti-fraude: id del ticket leído por la IA (read-ticket). Si el negocio
  // exige ticket, es obligatorio y el importe se toma de ese registro.
  ticketScanId: z.string().optional()
});

const MAX_DISTANCE_METERS = 200;

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation", message: parsed.error.message } }, { status: 400 });
  }
  const d = parsed.data;

  if (!(await customerAuthOk(req, d.customerId))) {
    return NextResponse.json({ error: { code: "unauthorized", message: "No autorizado" } }, { status: 401 });
  }

  const [business, customer] = await Promise.all([
    prisma.bubuiBusiness.findUnique({ where: { id: d.businessId } }),
    prisma.bubuiCustomer.findUnique({ where: { id: d.customerId } })
  ]);
  if (!business) return NextResponse.json({ error: { code: "not_found", message: "Negocio no existe" } }, { status: 404 });
  if (!business.active) return NextResponse.json({ error: { code: "inactive", message: "Negocio inactivo" } }, { status: 409 });
  if (!customer) return NextResponse.json({ error: { code: "not_found", message: "Cliente no existe" } }, { status: 404 });

  // ── Anti-fraude por ticket: el importe de confianza viene del OCR guardado
  //    (BubuiTicketScan), no del que teclee el cliente. Un ticket = una compra.
  let amount = d.amount;
  let ticketUrl = d.ticketUrl;
  let ticketScan: { id: string; amount: number | null; ticketUrl: string } | null = null;
  if (d.ticketScanId) {
    const ts = await prisma.bubuiTicketScan.findUnique({ where: { id: d.ticketScanId } });
    const fresh = ts && ts.createdAt > new Date(Date.now() - 30 * 60 * 1000);
    const mine = ts && (ts.customerId === d.customerId || ts.customerId === "anon");
    if (ts && fresh && mine && ts.usedByPurchaseId == null) {
      ticketScan = { id: ts.id, amount: ts.amount, ticketUrl: ts.ticketUrl };
      ticketUrl = ts.ticketUrl;
      if (ts.amount != null) amount = ts.amount; // importe de confianza (servidor)
    }
  }
  if (business.requireTicket && !ticketScan) {
    return NextResponse.json(
      { error: { code: "ticket_required", message: "Este negocio requiere la foto del ticket para validar el importe." } },
      { status: 400 }
    );
  }

  // Refresca la última ubicación conocida del cliente (panel admin): el escaneo
  // es la señal más fiable de dónde está físicamente. Se guarda aunque luego la
  // compra se rechace por geo (el GPS del móvil sigue siendo su posición real).
  // Fire-and-forget: no bloquea ni rompe el flujo de escaneo.
  if (d.scanLat != null && !Number.isNaN(d.scanLat) && d.scanLng != null && !Number.isNaN(d.scanLng)) {
    prisma.bubuiCustomer
      .update({ where: { id: d.customerId }, data: { lastLat: d.scanLat, lastLng: d.scanLng, lastLocationAt: new Date() } })
      .catch(() => {});
  }

  // Rate limit: máx 1 escaneo cliente-negocio cada 12h.
  const recent = await prisma.bubuiPurchase.findFirst({
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
  const activeOffer = await prisma.bubuiOffer.findFirst({
    where: {
      customerId: d.customerId,
      businessId: d.businessId,
      expiresAt: { gt: now },
      redeemed: false
    },
    orderBy: { discountPct: "desc" }
  });

  // Si hay un cupón canjeable activo, gana ese %. Si no, y la ruleta está
  // activa, sorteamos un % entre [wheelMinPct, wheelMaxPct]. Si no, el %
  // por defecto del negocio.
  let wheelSpin: { rolled: number; min: number; max: number } | null = null;
  let discountPct: number;
  if (activeOffer) {
    discountPct = activeOffer.discountPct;
  } else if (business.wheelEnabled) {
    const min = Math.max(0, Math.min(90, business.wheelMinPct ?? 3));
    const max = Math.max(min, Math.min(90, business.wheelMaxPct ?? 20));
    const rolled = min + Math.floor(Math.random() * (max - min + 1));
    discountPct = rolled;
    wheelSpin = { rolled, min, max };
  } else {
    discountPct = business.defaultDiscountPct;
  }
  const discountAmount = Math.round(amount * discountPct) / 100;

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

  const purchase = await prisma.bubuiPurchase.create({
    data: {
      customerId: d.customerId,
      businessId: d.businessId,
      amount,
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

  // Guarda la foto del ticket. Tolerante a fallo: si la columna `ticketUrl`
  // aún no existe en la DB (db push pendiente), el escaneo no se rompe.
  if (ticketUrl) {
    await prisma.bubuiPurchase
      .update({ where: { id: purchase.id }, data: { ticketUrl } })
      .catch(() => {});
  }
  // Marca el ticket como usado (un ticket = una compra, no reutilizable).
  if (ticketScan) {
    await prisma.bubuiTicketScan
      .update({ where: { id: ticketScan.id }, data: { usedByPurchaseId: purchase.id, businessId: d.businessId } })
      .catch(() => {});
  }

  let offersUnlocked = 0;
  if (!autoReject) {
    // Registro inmediato del ahorro (sin confirmación del negocio):
    // marca cupón canjeado, suma ahorro al cliente y desbloquea cercanos.
    if (activeOffer) {
      await prisma.bubuiOffer.update({
        where: { id: activeOffer.id },
        data: { redeemed: true, redeemedAt: new Date() }
      }).catch(() => {});
    }
    await prisma.bubuiCustomer.update({
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
    // Referidos B2B: este escaneo da "actividad real" al negocio. Si fue
    // referido por otro, su referidor puede haber alcanzado un nuevo múltiplo
    // de 5 negocios activos → se le concede una semana de banner (en cola).
    if (business.referrerId) {
      void import("@/lib/bubui/business-referral")
        .then((m) => m.syncBusinessReferralRewards(business.referrerId!))
        .catch(() => {});
    }
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
    offerRedeemed: !!activeOffer,
    wheelSpin
  });
}
