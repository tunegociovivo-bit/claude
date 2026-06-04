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

  // Guarda la última ubicación conocida del cliente (panel admin). No bloquea.
  if (lat != null && !Number.isNaN(lat) && lng != null && !Number.isNaN(lng)) {
    prisma.bubuiCustomer
      .update({ where: { id: customerId }, data: { lastLat: lat, lastLng: lng, lastLocationAt: new Date() } })
      .catch(() => {});
  }

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

  const enriched = offers.map((o) => {
    let distanceM: number | null = null;
    if (lat != null && lng != null && o.business.latitude != null && o.business.longitude != null) {
      distanceM = Math.round(
        haversineMeters(lat, lng, o.business.latitude, o.business.longitude)
      );
    }
    const hoursLeft = Math.max(0, (o.expiresAt.getTime() - now.getTime()) / (60 * 60 * 1000));
    return {
      offerId: o.id,
      business: o.business,
      discountPct: o.discountPct,
      rewardLabel: o.rewardLabel,
      source: o.source,
      expiresAt: o.expiresAt,
      hoursLeft: Math.round(hoursLeft),
      distanceM
    };
  });

  // Re-orden: primero las que están a punto de caducar (<24h), luego por
  // distancia, luego por score.
  enriched.sort((a, b) => {
    const aUrgent = a.hoursLeft < 24 ? 0 : 1;
    const bUrgent = b.hoursLeft < 24 ? 0 : 1;
    if (aUrgent !== bUrgent) return aUrgent - bUrgent;
    if (a.distanceM != null && b.distanceM != null) return a.distanceM - b.distanceM;
    return b.business.visibilityScore - a.business.visibilityScore;
  });

  return NextResponse.json({ items: enriched, count: enriched.length });
}
