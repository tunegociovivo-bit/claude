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
import { countVerifiedReferrals } from "@/lib/bubui/referral";
import { sharesLeft } from "@/lib/bubui/share-offer";

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
  const offers = await prisma.bubuiOffer.findMany({
    where: {
      customerId,
      expiresAt: { gt: now },
      redeemed: false
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
          latitude: true,
          longitude: true,
          logoUrl: true,
          brandColor: true,
          visibilityScore: true
        }
      }
    }
  });

  // Si hay ofertas-reto bloqueadas, calculamos cuántos amigos verificados
  // tiene ya el cliente (una sola query) para mostrar el progreso del reto.
  const hasLocked = offers.some((o) => !o.active);
  const verifiedNow = hasLocked ? await countVerifiedReferrals(customerId) : 0;

  const enriched = offers.map((o) => {
    let distanceM: number | null = null;
    if (lat != null && lng != null && o.business.latitude != null && o.business.longitude != null) {
      distanceM = Math.round(
        haversineMeters(lat, lng, o.business.latitude, o.business.longitude)
      );
    }
    const hoursLeft = Math.max(0, (o.expiresAt.getTime() - now.getTime()) / (60 * 60 * 1000));
    const locked = !o.active;
    return {
      offerId: o.id,
      business: o.business,
      discountPct: o.discountPct,
      rewardLabel: o.rewardLabel,
      source: o.source,
      expiresAt: o.expiresAt,
      hoursLeft: Math.round(hoursLeft),
      distanceM,
      // Oferta-reto viral: bloqueada hasta conseguir amigos.
      locked,
      friendsNeeded: locked ? o.unlockShares : 0,
      sharesLeft: locked ? sharesLeft(o, verifiedNow) : 0
    };
  });

  // Re-orden: primero las ofertas-reto bloqueadas (son el gancho viral, "X
  // amigos para activar tu Y%"), luego las que caducan pronto (<24h), luego
  // por distancia y score.
  enriched.sort((a, b) => {
    if (a.locked !== b.locked) return a.locked ? -1 : 1;
    const aUrgent = a.hoursLeft < 24 ? 0 : 1;
    const bUrgent = b.hoursLeft < 24 ? 0 : 1;
    if (aUrgent !== bUrgent) return aUrgent - bUrgent;
    if (a.distanceM != null && b.distanceM != null) return a.distanceM - b.distanceM;
    return b.business.visibilityScore - a.business.visibilityScore;
  });

  return NextResponse.json({ items: enriched, count: enriched.length });
}
