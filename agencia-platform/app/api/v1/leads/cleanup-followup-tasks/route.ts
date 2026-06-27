/**
 * POST /api/v1/leads/cleanup-followup-tasks
 *
 * Limpieza masiva (one-off) de las tareas "Seguir lead interesado" creadas por
 * NV Leads Pro:
 *   1. Soft-delete (a papelera, recuperable 30 días) de las que sigan activas.
 *   2. Borra sus eventos ESPEJO en Google Calendar (por lotes) y desvincula.
 *
 * Idempotente y por lotes: devuelve `remaining` (espejos de Google que aún
 * quedan) para que el cliente repita hasta llegar a 0. Solo admins.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { deleteTaskInGoogle } from "@/lib/integrations/google-calendar/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withApi({ scope: "*" }, async (_req, { api }) => {
  const me = api.userId
    ? await prisma.membership.findFirst({ where: { workspaceId: api.workspaceId, userId: api.userId } })
    : null;
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins");

  const match = {
    workspaceId: api.workspaceId,
    OR: [
      { customData: { path: ["source"], equals: "lead_interested" } as any },
      { title: { contains: "Seguir lead interesado" } }
    ]
  } as any;

  // 1) Soft-delete de las que sigan activas (a papelera).
  const del = await prisma.task.updateMany({
    where: { ...match, deletedAt: null },
    data: { deletedAt: new Date(), deletedById: api.userId ?? undefined } as any
  });

  // 2) Borrar sus espejos en Google Calendar (por lotes).
  let purgedFromGoogle = 0;
  let remaining = 0;
  const conn = await prisma.googleCalendarConnection.findFirst({
    where: { workspaceId: api.workspaceId, pushEnabled: true }
  });
  if (conn) {
    const batch = await prisma.task.findMany({
      where: { ...match, googleEventId: { not: null } },
      take: 120,
      select: { id: true, googleEventId: true, googleCalendarId: true }
    });
    for (const t of batch) {
      await deleteTaskInGoogle(t, conn);
      purgedFromGoogle++;
    }
    remaining = await prisma.task.count({ where: { ...match, googleEventId: { not: null } } });
  }

  return NextResponse.json({ ok: true, deleted: del.count, purgedFromGoogle, remaining });
});
