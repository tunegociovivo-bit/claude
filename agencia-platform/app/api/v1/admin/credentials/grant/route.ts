/**
 * POST /api/v1/admin/credentials/grant
 *
 * Genera un token de un solo uso que da acceso temporal a TODAS las
 * credenciales descifradas del workspace. Pensado para que el admin
 * comparta con el equipo de soporte (Claude) sin tener que copiar las
 * keys una a una.
 *
 * Defaults seguros:
 *   - Expira en 1 hora
 *   - Un solo uso (al hacer GET en /api/public/credentials/{token} se
 *     marca usedAt y la siguiente lectura falla)
 *   - Revocable
 *
 * GET (mismo endpoint): lista los grants previos del admin.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

async function requireAdmin(workspaceId: string, userId: string | undefined) {
  if (!userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const me = await prisma.membership.findFirst({ where: { workspaceId, userId } });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins");
}

const schema = z.object({
  ttlMinutes: z.number().int().min(5).max(60 * 24).default(60)
});

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);
  const items = await prisma.credentialAccessGrant.findMany({
    where: { workspaceId: api.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 20
  });
  return NextResponse.json({ items });
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  // Token aleatorio 48 bytes hex = 96 chars (alta entropía)
  const token = randomBytes(48).toString("hex");
  const expiresAt = new Date(Date.now() + parsed.data.ttlMinutes * 60 * 1000);

  const grant = await prisma.credentialAccessGrant.create({
    data: {
      workspaceId: api.workspaceId,
      token,
      createdById: api.userId,
      expiresAt
    }
  });

  return NextResponse.json({
    id: grant.id,
    token,
    expiresAt,
    // El propio cliente construye la URL absoluta — devolvemos sólo la path
    path: `/api/public/credentials/${token}`
  });
});
