/**
 * PATCH /api/bipi/business/[id]/profile
 *
 * Permite al dueño del negocio editar campos del perfil que afectan a la
 * página pública y al cartel. Auth simple v1: header
 * `Authorization: Bearer <businessId>:<random>` que se guarda en
 * localStorage tras login. v1 confiamos en que el token contiene el id —
 * en v2 firmamos JWT.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const schema = z.object({
  description: z.string().max(500).optional(),
  address: z.string().max(200).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  logoUrl: z.string().url().optional().nullable(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  defaultDiscountPct: z.number().int().min(3).max(30).optional(),
  crossDiscountPct: z.number().int().min(3).max(30).optional(),
  purchaseMode: z.enum(["double_confirm", "express"]).optional()
});

function tokenAllows(token: string | null, businessId: string): boolean {
  if (!token) return false;
  const m = /^Bearer\s+([\w-]+):/.exec(token);
  return !!m && m[1] === businessId;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = req.headers.get("authorization");
  if (!tokenAllows(auth, params.id)) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation", message: parsed.error.message } }, { status: 400 });
  }
  const updated = await prisma.bipiBusiness.update({
    where: { id: params.id },
    data: parsed.data
  });
  return NextResponse.json({
    ok: true,
    business: {
      id: updated.id,
      slug: updated.slug,
      description: updated.description,
      address: updated.address,
      latitude: updated.latitude,
      longitude: updated.longitude,
      logoUrl: updated.logoUrl,
      brandColor: updated.brandColor,
      defaultDiscountPct: updated.defaultDiscountPct,
      crossDiscountPct: updated.crossDiscountPct,
      purchaseMode: updated.purchaseMode
    }
  });
}
