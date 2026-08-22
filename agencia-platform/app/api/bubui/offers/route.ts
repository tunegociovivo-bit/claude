/**
 * GET /api/bubui/offers?customerId=...&lat=...&lng=...
 *
 * Devuelve las ofertas activas del cliente, ordenadas por:
 *   1. Caducidad próxima primero (FOMO).
 *   2. Cercanía si llegan coordenadas.
 *   3. Score de visibilidad del negocio.
 *
 * Filtra ofertas caducadas o ya canjeadas.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { haversineMeters } from "@/lib/bubui/core";
import { customerAuthOk } from "@/lib/bubui/customer-auth";
import { buildFriendChallengeProgress, friendsForChallengeOffer } from "@/lib/bubui/friend-challenge-progress";
import { sharesLeft } from "@/lib/bubui/share-offer";
import { getAltActionMinReferrals } from "@/lib/bubui/growth-settings";
import { mesaReviewUrl, mesaReviewPlatformLabel } from "@/lib/bubui/table";
import { getPlusEarlyAccessHours, isPlusActive } from "@/lib/bubui/plus";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const customerId = url.searchParams.get("customerId");
  const lat = url.searchParams.has("lat") ? Number(url.searchParams.get("lat")) : null;
  const lng = url.searchParams.has("lng") ? Number(url.searchParams.get("lng")) : null;
  if (!customerId) {
    return NextResponse.json({ error: { code: "missing_customer", message: "Falta customerId" } }, { status: 400 });
  }
  if (!(await customerAuthOk(req, customerId))) {
    return NextResponse.json({ error: { code: "unauthorized", message: "No autorizado" } }, { status: 401 });
  }

  // Actualiza estado del cliente para el panel admin (no bloquea):
  //  - versión de la app instalada + última conexión (siempre que la app las
  //    reporte), para saber qué build tiene cada usuario al hacer pruebas;
  //  - última ubicación conocida (solo si llegan coordenadas válidas).
  const appVersion = url.searchParams.get("appVersion") || undefined;
  const appBuild = url.searchParams.get("appBuild") || undefined;
  const appPlatform = url.searchParams.get("appPlatform") || undefined;
  const update: Record<string, unknown> = { lastSeenAt: new Date() };
  if (appVersion) update.appVersion = appVersion;
  if (appBuild) update.appBuild = appBuild;
  if (appPlatform) update.appPlatform = appPlatform;
  // Validamos rango geográfico real: un GPS erróneo (lat 361, etc.) no debe
  // corromper la última ubicación (rompería distancias/geofencing).
  if (
    lat != null && lng != null &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
  ) {
    update.lastLat = lat;
    update.lastLng = lng;
    update.lastLocationAt = new Date();
  }
  prisma.bubuiCustomer.update({ where: { id: customerId }, data: update as any }).catch(() => {});

  const now = new Date();
  // Acceso anticipado Plus: si está activado (>0h), quien NO sea Plus ve cada
  // oferta solo a partir de N horas tras generarse. Los Plus, al instante.
  const earlyHours = await getPlusEarlyAccessHours();
  let createdBefore: Date | null = null;
  if (earlyHours > 0) {
    const cust = await prisma.bubuiCustomer.findUnique({
      where: { id: customerId },
      select: { plan: true, planExpiresAt: true }
    });
    if (!isPlusActive(cust)) {
      createdBefore = new Date(now.getTime() - earlyHours * 3600_000);
    }
  }
  const offers = await prisma.bubuiOffer.findMany({
    where: {
      customerId,
      expiresAt: { gt: now },
      redeemed: false,
      ...(createdBefore ? { createdAt: { lte: createdBefore } } : {})
    },
    orderBy: { expiresAt: "asc" },
    include: {
      business: {
        select: {
          id: true,
          slug: true,
          name: true,
          category: true,
          city: true,
          address: true,
          phone: true,
          websiteUrl: true,
          instagramUrl: true,
          facebookUrl: true,
          tiktokUrl: true,
          latitude: true,
          longitude: true,
          logoUrl: true,
          coverImageUrl: true,
          challengeImageUrl: true,
          challengeServiceDescription: true,
          challengeServicePrice: true,
          challengeServiceMode: true,
          brandColor: true,
          visibilityScore: true,
          plan: true,
          planExpiresAt: true,
          // Para la activación alternativa de cupones-reto (reseña/foto).
          googlePlaceId: true,
          mesaReviewPlatform: true,
          tripadvisorUrl: true,
          trustpilotUrl: true
        }
      }
    }
  });

  // Si hay ofertas-reto bloqueadas, calculamos cuántos amigos verificados
  // tiene ya el cliente y sus iniciales (para el reto VISIBLE: caritas con la
  // inicial de cada amigo que ya cuenta + huecos por rellenar).
  const hasLocked = offers.some((o) => !o.active);
  const challengeParticipants = hasLocked
    ? await prisma.bubuiChallengeParticipant.findMany({
        where: { offerId: { in: offers.filter((offer) => !offer.active).map((offer) => offer.id) } },
        select: { offerId: true, friendCustomerId: true, status: true, registeredAt: true }
      })
    : [];
  const participantFriendIds = Array.from(new Set(challengeParticipants.map((participant) => participant.friendCustomerId)));
  const verifiedFriends = hasLocked
    ? await prisma.bubuiCustomer.findMany({
        where: {
          phoneVerified: true,
          OR: [
            { referredById: customerId },
            ...(participantFriendIds.length ? [{ id: { in: participantFriendIds } }] : [])
          ]
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, referralOfferId: true, referredById: true }
      })
    : [];
  const globallyReferredFriends = verifiedFriends.filter((friend) => friend.referredById === customerId);
  const verifiedNow = globallyReferredFriends.length;
  // Retos que exigen que los amigos compren: recuento por negocio (amigos que
  // ya compraron allí). Se calcula solo para los negocios implicados.
  const purchasersByBiz = new Map<string, Set<string>>();
  for (const o of offers) {
    if (o.active || purchasersByBiz.has(o.businessId)) continue;
    const welcomeOffers = await prisma.bubuiOffer.findMany({
      where: {
        businessId: o.businessId,
        customerId: { in: globallyReferredFriends.map((friend) => friend.id) },
        source: "referral_welcome"
      },
      select: { id: true, customerId: true }
    });
    const purchases = welcomeOffers.length
      ? await prisma.bubuiPurchase.findMany({
          where: {
            status: "confirmed",
            redeemedOfferId: { in: welcomeOffers.map((welcome) => welcome.id) }
          },
          select: { redeemedOfferId: true },
          distinct: ["redeemedOfferId"]
        })
      : [];
    const redeemedIds = new Set(purchases.map((purchase) => purchase.redeemedOfferId).filter(Boolean));
    purchasersByBiz.set(
      o.businessId,
      new Set(welcomeOffers.filter((welcome) => redeemedIds.has(welcome.id)).map((welcome) => welcome.customerId))
    );
  }
  const sharesCountFor = (o: { active: boolean; businessId: string; unlockRequiresPurchase?: boolean | null }) =>
    !o.active && o.unlockRequiresPurchase ? (purchasersByBiz.get(o.businessId)?.size ?? 0) : verifiedNow;
  // La activación alternativa (reseña/foto) de los cupones-reto se desbloquea al
  // llegar al umbral de amigos dados de alta (configurable por el admin).
  const altMinReferrals = hasLocked ? await getAltActionMinReferrals() : 0;
  const altActionsUnlocked = hasLocked && verifiedNow >= altMinReferrals;
  const friendInitials = globallyReferredFriends.map((f) => (f.name?.trim()?.[0] || "?").toUpperCase());

  // Negocios donde el cliente YA dejó (verificada) una reseña en Google: no
  // le volvemos a ofrecer reseñar (Google solo permite una por usuario/sitio).
  const googleReviewedIds = hasLocked
    ? new Set(
        (
          await prisma.bubuiGoogleReview.findMany({
            where: { customerId, businessId: { in: offers.filter((o) => !o.active).map((o) => o.businessId) } },
            select: { businessId: true }
          })
        ).map((r) => r.businessId)
      )
    : new Set<string>();

  const enriched = offers.map((o) => {
    let distanceM: number | null = null;
    if (lat != null && lng != null && o.business.latitude != null && o.business.longitude != null) {
      distanceM = Math.round(
        haversineMeters(lat, lng, o.business.latitude, o.business.longitude)
      );
    }
    const hoursLeft = Math.max(0, (o.expiresAt.getTime() - now.getTime()) / (60 * 60 * 1000));
    const locked = !o.active;
    const offerParticipants = challengeParticipants.filter((participant) => participant.offerId === o.id);
    const hasParticipantProgress = offerParticipants.length > 0;
    const attributedFriends = friendsForChallengeOffer(o.id, verifiedFriends, challengeParticipants);
    const usesAttributedProgress = o.usesExactReferralTracking || hasParticipantProgress;
    const attributedPurchasers = new Set<string>(
      !o.usesExactReferralTracking && !hasParticipantProgress
        ? (purchasersByBiz.get(o.businessId) ?? [])
        : []
    );
    offerParticipants
      .filter((participant) => participant.status === "confirmed")
      .forEach((participant) => attributedPurchasers.add(participant.friendCustomerId));
    const cnt = usesAttributedProgress
      ? (o.unlockRequiresPurchase
          ? attributedFriends.filter((friend) => attributedPurchasers.has(friend.id)).length
          : attributedFriends.length)
      : sharesCountFor(o);
    const left = locked
      ? (usesAttributedProgress ? Math.max(0, o.unlockShares - cnt) : sharesLeft(o, cnt))
      : 0;
    const have = locked ? Math.max(0, o.unlockShares - left) : 0;
    // Referido prioritario: negocios de pago (Pro/Premium) destacan en el feed.
    const priority =
      (o.business.plan === "pro" || o.business.plan === "premium") &&
      (!o.business.planExpiresAt || o.business.planExpiresAt.getTime() > now.getTime());
    return {
      offerId: o.id,
      business: o.business,
      priority,
      discountPct: o.discountPct,
      rewardLabel: o.rewardLabel,
      source: o.source,
      expiresAt: o.expiresAt,
      hoursLeft: Math.round(hoursLeft),
      daysLeft: Math.max(1, Math.ceil(hoursLeft / 24)),
      // Cupones creados antes de guardar estos campos en la oferta conservan
      // el detalle actual del negocio, para que el CTA nunca aparezca vacío.
      challengeServiceDescription: o.challengeServiceDescription ?? o.business.challengeServiceDescription,
      challengeServicePrice: o.challengeServicePrice ?? o.business.challengeServicePrice,
      challengeServiceMode: o.challengeServiceMode ?? o.business.challengeServiceMode,
      challengeInviterName: o.challengeInviterName,
      distanceM,
      // Oferta-reto viral: bloqueada hasta conseguir amigos.
      locked,
      friendsNeeded: locked ? o.unlockShares : 0,
      sharesLeft: left,
      // Con desbloqueo por COMPRA, los amigos registrados aún no cuentan
      // (cuentan al gastar su cupón) — este campo permite a la app mostrar
      // "N amigos registrados, pendientes de compra" en vez de nada.
      friendsRegistered: locked ? (usesAttributedProgress ? attributedFriends.length : verifiedNow) : 0,
      // Reto visible: iniciales de los amigos que ya cuentan para ESTE reto.
      friendsJoined: locked ? friendInitials.slice(0, have) : [],
      friendProgress: locked
        ? buildFriendChallengeProgress(usesAttributedProgress ? attributedFriends : globallyReferredFriends, attributedPurchasers, o.unlockShares)
        : [],
      // Activación alternativa por acción (reseña/foto) — solo cupones-reto y
      // solo si el usuario ya superó el umbral de amigos.
      altActionsUnlocked: locked && o.source === "share_challenge" ? altActionsUnlocked : false,
      altMinReferrals,
      reviewUrl: locked && !googleReviewedIds.has(o.businessId) ? mesaReviewUrl(o.business) : null,
      reviewLabel: locked && !googleReviewedIds.has(o.businessId) ? mesaReviewPlatformLabel(o.business) : null
    };
  });

  // Re-orden: primero las ofertas-reto bloqueadas (son el gancho viral, "X
  // amigos para activar tu Y%"), luego las que caducan pronto (<24h), luego
  // por distancia y score.
  enriched.sort((a, b) => {
    if (a.locked !== b.locked) return a.locked ? -1 : 1;
    // Referido prioritario: los negocios de pago destacan en posición.
    if (a.priority !== b.priority) return a.priority ? -1 : 1;
    const aUrgent = a.hoursLeft < 24 ? 0 : 1;
    const bUrgent = b.hoursLeft < 24 ? 0 : 1;
    if (aUrgent !== bUrgent) return aUrgent - bUrgent;
    if (a.distanceM != null && b.distanceM != null) return a.distanceM - b.distanceM;
    return b.business.visibilityScore - a.business.visibilityScore;
  });

  return NextResponse.json(
    { items: enriched, count: enriched.length },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
