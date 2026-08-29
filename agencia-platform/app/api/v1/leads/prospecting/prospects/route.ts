import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const schema = z.object({
  prospectId: z.string().min(1),
  action: z.enum(["exclude", "reactivate", "retry", "qualified", "meeting"])
});

export const PATCH = withApi({ scope: "*", admin: true, rate: "admin" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const prospect = await prisma.prospectingProspect.findFirst({
    where: { id: parsed.data.prospectId, workspaceId: api.workspaceId },
    include: { campaign: { select: { status: true } } }
  });
  if (!prospect) throw new ApiError(404, "not_found", "Prospecto no encontrado");
  const now = new Date();
  const action = parsed.data.action;
  if (["reactivate", "retry"].includes(action) && !prospect.linkedinUrl && !prospect.email && !prospect.phone) {
    throw new ApiError(409, "profile_unresolved", "Resuelve primero el perfil o añade un canal de contacto verificable");
  }
  const status = action === "exclude" ? "excluded" : action === "qualified" ? "qualified" : action === "meeting" ? "meeting" : prospect.campaign.status === "active" ? "active" : "pending";
  await prisma.$transaction(async (tx) => {
    await tx.prospectingProspect.update({
      where: { id: prospect.id },
      data: {
        status,
        nextActionAt: ["excluded", "qualified", "meeting"].includes(status) ? null : now,
        stopReason: action === "exclude" ? "Excluido por un administrador" : action === "qualified" ? "Marcado como cualificado" : action === "meeting" ? "Reunión conseguida" : null
      }
    });
    if (["exclude", "qualified", "meeting"].includes(action)) {
      await tx.prospectingActivity.updateMany({
        where: { prospectId: prospect.id, workspaceId: api.workspaceId, status: { in: ["queued", "awaiting_review", "failed"] } },
        data: { status: "skipped", executedAt: now, error: `Cadencia detenida: ${action}` }
      });
    }
    if (action === "retry") {
      await tx.prospectingActivity.updateMany({
        where: { prospectId: prospect.id, workspaceId: api.workspaceId, status: "failed" },
        data: { status: "queued", error: null, executedAt: null }
      });
    }
  });
  return NextResponse.json({ ok: true, status });
});

export const DELETE = withApi({ scope: "*", admin: true, rate: "admin" }, async (req, { api }) => {
  const prospectId = new URL(req.url).searchParams.get("prospectId");
  if (!prospectId) throw new ApiError(400, "validation_error", "Falta prospectId");
  const prospect = await prisma.prospectingProspect.findFirst({ where: { id: prospectId, workspaceId: api.workspaceId }, include: { campaign: { select: { status: true } }, _count: { select: { activities: true } } } });
  if (!prospect) throw new ApiError(404, "not_found", "Prospecto no encontrado");
  if (prospect.campaign.status === "active" || prospect._count.activities) throw new ApiError(409, "cannot_delete", "Excluye el prospecto: no se puede borrar si la campaña está activa o ya existe historial");
  await prisma.prospectingProspect.delete({ where: { id: prospect.id } });
  return NextResponse.json({ ok: true });
});
