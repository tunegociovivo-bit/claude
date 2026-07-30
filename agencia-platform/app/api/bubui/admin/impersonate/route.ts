/**
 * POST /api/bubui/admin/impersonate  → { businessId }
 *
 * Emite una sesión del panel de negocio para el ADMIN de Bubui, para poder
 * entrar en el panel de cualquier comercio y configurarlo como si fuera el
 * dueño (muchos dueños piden que se lo configuremos nosotros).
 *
 * Devuelve el mismo shape que /api/bubui/business/login, así el front solo
 * tiene que guardar la sesión en localStorage y abrir /bubui/negocio.
 *
 * Nota: REUTILIZA el apiToken vigente si existe (así no se invalida la
 * sesión que el dueño tenga abierta). Solo si el negocio aún no tiene
 * apiToken se genera y persiste uno, igual que hace el login.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { adminTokenOk } from "@/lib/bubui/admin";

export const dynamic = "force-dynamic";

const schema = z.object({ businessId: z.string().min(1) });

export async function POST(req: Request) {
  if (!(await adminTokenOk(req))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation", message: parsed.error.message } }, { status: 400 });
  }
  const business = await prisma.bubuiBusiness.findUnique({
    where: { id: parsed.data.businessId },
    select: { id: true, name: true, slug: true, apiToken: true }
  });
  if (!business) {
    return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  }

  let secret = business.apiToken;
  if (!secret) {
    secret = randomBytes(24).toString("hex");
    await prisma.bubuiBusiness.update({ where: { id: business.id }, data: { apiToken: secret } });
  }

  return NextResponse.json({
    ok: true,
    businessId: business.id,
    name: business.name,
    slug: business.slug,
    token: `${business.id}:${secret}`
  });
}
