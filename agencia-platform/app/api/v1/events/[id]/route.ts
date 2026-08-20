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
import { pushEventIfConnected, deleteEventInGoogle } from "@/lib/integrations/google-calendar/sync";
import { calendarEventVisibility } from "@/lib/calendar/visibility";

export const PATCH = withApi({ scope: "events:write" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => null);
  const parsed = eventCreateSchema.partial().safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const data: any = { ...parsed.data };
  if (data.startAt) data.startAt = new Date(data.startAt);
  if (data.endAt) data.endAt = new Date(data.endAt);
  const updated = await prisma.calendarEvent.updateMany({
    where: { id: params.id, workspaceId: api.workspaceId, ...calendarEventVisibility(api.userId) },
    data
  });
  if (updated.count === 0) throw new ApiError(404, "not_found", "Evento no encontrado");
  void pushEventIfConnected(params.id).catch((e) => console.warn("[gcal push] update:", e?.message ?? e));
  return NextResponse.json({ ok: true });
});

export const DELETE = withApi({ scope: "events:write" }, async (_req, { params, api }) => {
  // Capturamos info de Google antes del borrado para poder propagarlo.
  const snapshot = await prisma.calendarEvent.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, ...calendarEventVisibility(api.userId) },
    select: {
      googleEventId: true,
      googleCalendarId: true,
      googleOwnerUserId: true,
      workspaceId: true
    }
  });
  const deleted = await prisma.calendarEvent.deleteMany({
    where: { id: params.id, workspaceId: api.workspaceId, ...calendarEventVisibility(api.userId) }
  });
  if (deleted.count === 0) throw new ApiError(404, "not_found", "Evento no encontrado");

  // Propagar borrado a Google si el evento estaba sincronizado.
  if (snapshot?.googleEventId) {
    const conn = snapshot.googleOwnerUserId
      ? await prisma.googleCalendarConnection.findUnique({
          where: {
            userId_workspaceId: {
              userId: snapshot.googleOwnerUserId,
              workspaceId: snapshot.workspaceId
            }
          }
        })
      : await prisma.googleCalendarConnection.findFirst({
          where: { workspaceId: snapshot.workspaceId, pushEnabled: true }
        });
    if (conn) {
      void deleteEventInGoogle(snapshot, conn).catch((e) =>
        console.warn("[gcal push] delete:", e?.message ?? e)
      );
    }
  }
  return NextResponse.json({ ok: true });
});
