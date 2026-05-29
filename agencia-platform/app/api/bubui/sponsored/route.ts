/**
 * GET /api/bubui/sponsored?city=...
 *
 * Lista los slots patrocinados activos (startsAt <= now < endsAt) en la
 * ciudad solicitada. Se usa en el feed del cliente como "hero". Máximo 3
 * para no saturar.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const city = (url.searchParams.get("city") || "").trim();
  if (!city) return NextResponse.json({ items: [] });

  const now = new Date();
  const slots = await prisma.bubuiSponsoredSlot.findMany({
    where: { city, startsAt: { lte: now }, endsAt: { gt: now } },
    orderBy: { startsAt: "desc" },
    take: 3,
    include: {
      business: { select: { id: true, slug: true, name: true, brandColor: true, defaultDiscountPct: true } }
    }
  });
  return NextResponse.json({
    items: slots.map((s) => ({
      id: s.id,
      title: s.title,
      body: s.body,
      endsAt: s.endsAt,
      business: s.business
    }))
  });
}
