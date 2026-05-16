/**
 * PATCH  /api/v1/events/[id]  → actualiza evento
 * DELETE /api/v1/events/[id]  → borra evento
 *
 * Ambas operaciones scoped al workspace del usuario.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { eventCreateSchema } from "@/lib/api/schemas";

export const PATCH = withApi({ scope: "events:write" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => null);
  const parsed = eventCreateSchema.partial().safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const data: any = { ...parsed.data };
  if (data.startAt) data.startAt = new Date(data.startAt);
  if (data.endAt) data.endAt = new Date(data.endAt);
  const updated = await prisma.calendarEvent.updateMany({
    where: { id: params.id, workspaceId: api.workspaceId },
    data
  });
  if (updated.count === 0) throw new ApiError(404, "not_found", "Evento no encontrado");
  return NextResponse.json({ ok: true });
});

export const DELETE = withApi({ scope: "events:write" }, async (_req, { params, api }) => {
  const deleted = await prisma.calendarEvent.deleteMany({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  if (deleted.count === 0) throw new ApiError(404, "not_found", "Evento no encontrado");
  return NextResponse.json({ ok: true });
});
