/**
 * POST /api/bubui/business/reset-password  { token, password }
 *
 * Valida el token (hash + no caducado), actualiza ownerPasswordHash y borra
 * el token de un solo uso. Devuelve un token de sesión para entrar directo.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const schema = z.object({
  token: z.string().min(10),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres")
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation", message: parsed.error.issues[0]?.message ?? "Datos no válidos" } },
      { status: 400 }
    );
  }
  const { token, password } = parsed.data;
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const business = await prisma.bubuiBusiness.findFirst({
    where: { ownerResetTokenHash: tokenHash, ownerResetExpiresAt: { gt: new Date() } }
  });
  if (!business) {
    return NextResponse.json(
      { error: { code: "invalid_token", message: "El enlace no es válido o ha caducado. Pide uno nuevo." } },
      { status: 400 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.bubuiBusiness.update({
    where: { id: business.id },
    data: { ownerPasswordHash: passwordHash, ownerResetTokenHash: null, ownerResetExpiresAt: null }
  });

  const sessionToken = `${business.id}:${randomBytes(16).toString("hex")}`;
  return NextResponse.json({
    ok: true,
    businessId: business.id,
    name: business.name,
    slug: business.slug,
    token: sessionToken
  });
}
