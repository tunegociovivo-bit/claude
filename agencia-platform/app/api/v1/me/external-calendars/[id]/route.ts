/**
 * PATCH  /api/v1/me/external-calendars/[id]  → editar (name/color/enabled)
 * DELETE /api/v1/me/external-calendars/[id]  → borrar
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  enabled: z.boolean().optional(),
  icsUrl: z.string().url().or(z.string().startsWith("webcal://")).optional()
});

export const PATCH = withApi({ scope: "*" }, async (req, { params, api }) => {
  if (!api.userId) throw new ApiError(401, "unauthorized", "No hay usuario");
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const updated = await prisma.userExternalCalendar.updateMany({
    where: { id: params.id, userId: api.userId },
    data: parsed.data
  });
  if (updated.count === 0) throw new ApiError(404, "not_found", "Calendario no encontrado");
  return NextResponse.json({ ok: true });
});

export const DELETE = withApi({ scope: "*" }, async (_req, { params, api }) => {
  if (!api.userId) throw new ApiError(401, "unauthorized", "No hay usuario");
  const deleted = await prisma.userExternalCalendar.deleteMany({
    where: { id: params.id, userId: api.userId }
  });
  if (deleted.count === 0) throw new ApiError(404, "not_found", "Calendario no encontrado");
  return NextResponse.json({ ok: true });
});
