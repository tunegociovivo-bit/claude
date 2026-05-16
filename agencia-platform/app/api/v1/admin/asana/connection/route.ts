/**
 * GET /api/v1/admin/asana/connection
 *
 * Devuelve si el usuario logueado ya tiene un token de Asana
 * guardado (cifrado en AsanaConnection). NO expone el token en el
 * response — la UI solo necesita saber si existe para mostrar
 * "usar token guardado" en lugar de pedirlo cada vez.
 *
 * DELETE → borra la conexión (rotación / desvincular).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "admin" }, async (_req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Se requiere sesión humana");
  const conn = await prisma.asanaConnection.findFirst({
    where: { userId: api.userId },
    select: { id: true, asanaUserId: true, createdAt: true }
  });
  return NextResponse.json({
    hasToken: !!conn,
    asanaUserId: conn?.asanaUserId ?? null,
    createdAt: conn?.createdAt ?? null
  });
});

export const DELETE = withApi({ scope: "admin" }, async (_req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Se requiere sesión humana");
  await prisma.asanaConnection.deleteMany({ where: { userId: api.userId } });
  return NextResponse.json({ ok: true });
});
