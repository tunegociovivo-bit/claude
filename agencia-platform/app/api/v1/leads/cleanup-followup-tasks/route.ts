/**
 * POST /api/v1/leads/cleanup-followup-tasks
 *
 * Limpieza masiva (one-off) de las tareas "Seguir lead interesado" que NV Leads
 * Pro creó automáticamente. Soft-delete (a papelera, recuperable 30 días). El
 * cron de calendar-sync borrará después sus espejos en Google Calendar (si los
 * había), porque quedan con deletedAt != null.
 *
 * Solo admins del workspace.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*" }, async (_req, { api }) => {
  const me = api.userId
    ? await prisma.membership.findFirst({ where: { workspaceId: api.workspaceId, userId: api.userId } })
    : null;
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins");

  const where = {
    workspaceId: api.workspaceId,
    deletedAt: null,
    OR: [
      { customData: { path: ["source"], equals: "lead_interested" } as any },
      { title: { contains: "Seguir lead interesado" } }
    ]
  } as any;

  const count = await prisma.task.count({ where });
  const res = await prisma.task.updateMany({
    where,
    data: { deletedAt: new Date(), deletedById: api.userId ?? undefined } as any
  });

  return NextResponse.json({ ok: true, deleted: res.count, matched: count });
});
