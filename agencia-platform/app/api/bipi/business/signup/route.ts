/**
 * POST /api/bipi/business/signup
 *
 * Registra un negocio nuevo en Bipi. Crea el slug único, hashea la
 * contraseña del dueño y devuelve el businessId + scanUrl (que es lo que
 * pondremos en el QR del cartel).
 *
 * Si el body incluye `referrerBusinessId` (porque el dueño llegó a Bipi
 * escaneando el QR de otro negocio), se registra la referencia para el
 * programa Embajador.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { uniqueBusinessSlug, bipiScanUrl } from "@/lib/bipi/core";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().min(2).max(80),
  category: z.string().min(2).max(40),
  description: z.string().max(500).optional(),
  city: z.string().max(60).optional().default("Benalmádena"),
  province: z.string().max(60).optional().default("Málaga"),
  address: z.string().max(200).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  defaultDiscountPct: z.number().int().min(3).max(30).optional().default(5),
  crossDiscountPct: z.number().int().min(3).max(30).optional().default(8),
  ownerEmail: z.string().email(),
  ownerPassword: z.string().min(8).max(60),
  ownerName: z.string().max(80).optional(),
  ownerPhone: z.string().max(40).optional(),
  referrerBusinessId: z.string().optional()
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation", message: parsed.error.message } },
      { status: 400 }
    );
  }
  const d = parsed.data;

  const exists = await prisma.bubuiBusiness.findUnique({ where: { ownerEmail: d.ownerEmail } });
  if (exists) {
    return NextResponse.json(
      { error: { code: "email_taken", message: "Ya hay un negocio con ese email" } },
      { status: 409 }
    );
  }

  const slug = await uniqueBusinessSlug(d.name);
  const passwordHash = await bcrypt.hash(d.ownerPassword, 10);

  const business = await prisma.bubuiBusiness.create({
    data: {
      slug,
      name: d.name,
      category: d.category,
      description: d.description,
      city: d.city,
      province: d.province,
      address: d.address,
      latitude: d.latitude,
      longitude: d.longitude,
      defaultDiscountPct: d.defaultDiscountPct,
      crossDiscountPct: d.crossDiscountPct,
      ownerEmail: d.ownerEmail,
      ownerPasswordHash: passwordHash,
      ownerName: d.ownerName,
      ownerPhone: d.ownerPhone,
      referrerId: d.referrerBusinessId ?? null
    }
  });

  const origin = new URL(req.url).origin;
  return NextResponse.json(
    {
      ok: true,
      businessId: business.id,
      slug: business.slug,
      scanUrl: bipiScanUrl(business.id, origin),
      qrPngUrl: `/api/bipi/business/${business.id}/qr.png`,
      posterUrl: `/api/bipi/business/${business.id}/poster.png`
    },
    { status: 201 }
  );
}
