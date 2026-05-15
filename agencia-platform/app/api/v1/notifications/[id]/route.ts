import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const PATCH = withApi({ scope: "*" }, async (_req, { params, api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const updated = await prisma.notification.updateMany({
    where: { id: params.id, userId: api.userId },
    data: { read: true }
  });
  if (updated.count === 0) throw new ApiError(404, "not_found", "Notificación no encontrada");
  return NextResponse.json({ ok: true });
});

export const DELETE = withApi({ scope: "*" }, async (_req, { params, api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const result = await prisma.notification.deleteMany({
    where: { id: params.id, userId: api.userId }
  });
  if (result.count === 0) throw new ApiError(404, "not_found", "Notificación no encontrada");
  return NextResponse.json({ ok: true });
});
