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
import { isNewCustomer } from "@/lib/bubui/table";
import { createShareChallengeOffer } from "@/lib/bubui/share-offer";
import { reevaluateChallengeAfterFriendCouponRedemption } from "@/lib/bubui/challenge-redemption";
import { notifyBusinessNewReferredClient } from "@/lib/bubui/referral";
import { alertBusiness } from "@/lib/bubui/business-push";
import { computeWalletApplication, consumeWallet } from "@/lib/bubui/wallet";

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
      redeemed: false,
      active: true // las ofertas-reto bloqueadas no se aplican hasta desbloquearse
    },
    orderBy: { discountPct: "desc" }
  });

  // Si hay un cupón canjeable activo, gana ese %. Si no, y la ruleta está
  // activa, sorteamos un % entre [wheelMinPct, wheelMaxPct]. Si no, el %
  // por defecto del negocio.
  let wheelSpin: { rolled: number; min: number; max: number } | null = null;
  let discountPct: number;
  if (activeOffer) {
    // Oferta ya ganada (cupón cruzado de otro negocio, recompensa por acción,
    // descuento post-compra…). Es la vía del cliente recurrente.
    discountPct = activeOffer.discountPct;
  } else if (isNewCustomer(customer)) {
    // Cliente NUEVO (primera compra con Bubui aquí): descuento de BIENVENIDA.
    // Si el negocio no fijó uno específico, usamos defaultDiscountPct (compat
    // con la config previa) para no dejar al nuevo sin descuento.
    discountPct =
      (business.newCustomerDiscountPct ?? 0) > 0
        ? business.newCustomerDiscountPct
        : business.defaultDiscountPct;
  } else if (business.wheelEnabled) {
    // Ruleta: gamificación opt-in que el negocio activa a propósito.
    const min = Math.max(0, Math.min(90, business.wheelMinPct ?? 3));
    const max = Math.max(min, Math.min(90, business.wheelMaxPct ?? 20));
    const rolled = min + Math.floor(Math.random() * (max - min + 1));
    discountPct = rolled;
    wheelSpin = { rolled, min, max };
  } else {
    // Cliente RECURRENTE sin oferta ganada: NO hay descuento solo por escanear.
    // Lo gana con acciones (compartir, reseña…) o con cupones de otros negocios.
    discountPct = 0;
  }
  let discountAmount = Math.round(amount * discountPct) / 100;

  // Hucha de referidos ("yendo solo"): si el cliente tiene saldo y le ahorra MÁS
  // que el descuento base, se cobra aquí. Aplica hasta el tope por visita del
  // negocio (mesaMaxPct) y solo sobre los primeros € (anti-abuso de mesa grande);
  // el % consumido se descuenta y el resto queda acumulado. No consume el cupón
  // base (sigue disponible para otra visita).
  let walletUsed = false;
  let walletInfo: { appliedPct: number; eligibleAmount: number } | null = null;
  const walletCand = computeWalletApplication(customer, amount, business.mesaMaxPct ?? 20);
  if (walletCand && walletCand.discountAmount > discountAmount) {
    walletUsed = true;
    discountPct = walletCand.appliedPct;
    discountAmount = walletCand.discountAmount;
    walletInfo = { appliedPct: walletCand.appliedPct, eligibleAmount: walletCand.eligibleAmount };
  }
  // Si gana la hucha, no se canjea el cupón base.
  const offerApplied = !walletUsed && !!activeOffer;

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
      redeemedOfferId: offerApplied ? activeOffer?.id : undefined,
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
    // Si se cobró la hucha de referidos, consume el % aplicado (el resto sigue
    // acumulado). No se hace si ganó el cupón base.
    if (walletUsed && walletCand) {
      await consumeWallet(customer, walletCand.remaining);
    }
    // Avisa al negocio si es un cliente REFERIDO que viene por 1ª vez a su local
    // (la señal que el comercio quiere: "Bubui me trae clientes nuevos").
    void notifyBusinessNewReferredClient({ businessId: d.businessId, customer }).catch(() => {});
    // Cupón Bubui canjeado → señal de "Bubui me genera ventas". Se omite el de
    // bienvenida (referral_welcome) para no duplicar con el aviso de cliente nuevo.
    if (offerApplied && activeOffer && activeOffer.source !== "referral_welcome") {
      void alertBusiness(d.businessId, {
        type: "coupon",
        message: `🎟️ Un cliente ha canjeado un cupón Bubui (${discountPct}% sobre ${amount}€).`,
        pushTitle: "🎟️ Cupón Bubui canjeado",
        link: "/bubui/negocio"
      });
    }
    // Registro inmediato del ahorro (sin confirmación del negocio):
    // marca cupón canjeado, suma ahorro al cliente y desbloquea cercanos.
    if (offerApplied && activeOffer) {
      await prisma.bubuiOffer.update({
        where: { id: activeOffer.id },
        data: { redeemed: true, redeemedAt: new Date() }
      }).catch(() => {});
      void reevaluateChallengeAfterFriendCouponRedemption({
        source: activeOffer.source,
        referredById: customer.referredById,
        referralOfferId: customer.referralOfferId
      }).catch(() => {});
      if (customer.referralOfferId) {
        void prisma.bubuiChallengeParticipant.updateMany({
          where: { offerId: customer.referralOfferId, friendCustomerId: d.customerId },
          data: { status: "confirmed", decidedAt: new Date(), nextFollowupAt: null }
        }).catch(() => {});
      }
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

  // Oferta-reto viral: tras escanear, se le crea una oferta MAYOR bloqueada
  // que se activa al conseguir N amigos verificados (motor de expansión).
  let shareOffer: Awaited<ReturnType<typeof createShareChallengeOffer>> = null;
  if (!autoReject) {
    shareOffer = await createShareChallengeOffer({
      customerId: d.customerId,
      business: {
        id: business.id,
        shareOfferPct: business.shareOfferPct,
        shareOfferFriends: business.shareOfferFriends,
        shareOfferLabel: business.shareOfferLabel,
        shareOfferRequiresPurchase: business.shareOfferRequiresPurchase
      },
      purchaseId: purchase.id
    }).catch(() => null);
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
    offerRedeemed: offerApplied,
    // Si se cobró la hucha de referidos: % aplicado y € de cuenta elegibles.
    wallet: walletInfo,
    wheelSpin,
    // Para que la app muestre el reto "compártela con N amigos para activarla".
    shareOffer: shareOffer
      ? {
          discountPct: shareOffer.discountPct,
          label: shareOffer.label,
          friends: shareOffer.friends,
          expiresAt: shareOffer.expiresAt
        }
      : null
  });
}
