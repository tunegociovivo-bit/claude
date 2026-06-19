/**
 * POST /api/v1/admin/bubui/directory/backfill-geo
 * Body (opcional): { limit?: number }
 *
 * Rellena coordenadas y normaliza la localidad/provincia de negocios Bubui ya
 * existentes que se dieron de alta sin geocoding (lat/long nulos). Tope por
 * llamada para no agotar el tiempo de ejecución; repetible.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { geocodeAddress } from "@/lib/bubui/geocode";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = withApi({ scope: "*", rate: "admin" }, async (req) => {
  const body = (await req.json().catch(() => ({}))) as { limit?: number };
  const limit = Math.min(Math.max(body.limit ?? 25, 1), 100);

  const pending = await prisma.bubuiBusiness.findMany({
    where: { OR: [{ latitude: null }, { longitude: null }] },
    select: { id: true, address: true, city: true, province: true },
    take: limit
  });

  let updated = 0;
  let failed = 0;
  for (const b of pending) {
    const query = [b.address, b.city, b.province, "España"].filter(Boolean).join(", ");
    const geo = await geocodeAddress(query);
    if (!geo) { failed++; continue; }
    await prisma.bubuiBusiness.update({
      where: { id: b.id },
      data: {
        latitude: geo.latitude,
        longitude: geo.longitude,
        ...(geo.city ? { city: geo.city } : {}),
        ...(geo.province ? { province: geo.province } : {})
      }
    });
    updated++;
  }

  const remaining = await prisma.bubuiBusiness.count({ where: { OR: [{ latitude: null }, { longitude: null }] } });
  return NextResponse.json({ ok: true, processed: pending.length, updated, failed, remaining });
});
