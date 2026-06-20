/**
 * POST /api/bubui/business/claim
 * Body: { token }
 *
 * Auto-login SIN contraseña para fichas pre-creadas desde un lead. Valida el
 * claimToken (no caducado), emite un secreto de sesión y devuelve el mismo
 * formato que /business/login para que el panel entre directo. El negocio
 * sigue PENDIENTE (active=false) hasta que pulse "Activar".
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const schema = z.object({ token: z.string().min(10) });

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation", message: parsed.error.message } }, { status: 400 });
  }
  const business = await prisma.bubuiBusiness.findUnique({ where: { claimToken: parsed.data.token } });
  if (!business) {
    return NextResponse.json({ error: { code: "invalid_token", message: "Enlace no válido o ya usado." } }, { status: 404 });
  }
  if (business.claimExpiresAt && business.claimExpiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: { code: "expired", message: "El enlace ha caducado. Pídenos uno nuevo." } }, { status: 410 });
  }

  // Emite el secreto de sesión (igual que el login).
  const secret = randomBytes(24).toString("hex");
  await prisma.bubuiBusiness.update({ where: { id: business.id }, data: { apiToken: secret } });

  return NextResponse.json({
    ok: true,
    businessId: business.id,
    name: business.name,
    slug: business.slug,
    token: `${business.id}:${secret}`,
    pending: !business.claimedAt,
    active: business.active
  });
}
