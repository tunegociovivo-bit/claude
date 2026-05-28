/**
 * POST /api/bubui/push-quote
 *
 * Devuelve el precio dinámico de un "Push del Día" para un negocio según
 * el radio y la ciudad. Pre-cotización antes de cargar el cobro.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { dynamicPushPriceEur } from "@/lib/bubui/core";

export const dynamic = "force-dynamic";

const schema = z.object({
  businessId: z.string().min(1),
  radiusKm: z.number().positive().max(10)
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation", message: parsed.error.message } }, { status: 400 });
  }
  const business = await prisma.bubuiBusiness.findUnique({ where: { id: parsed.data.businessId } });
  if (!business) {
    return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  }
  const { reach, priceEur } = dynamicPushPriceEur({
    radiusKm: parsed.data.radiusKm,
    city: business.city
  });
  return NextResponse.json({
    reach,
    priceEur,
    radiusKm: parsed.data.radiusKm,
    city: business.city
  });
}
