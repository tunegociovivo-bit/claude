import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { projectCreateSchema } from "@/lib/api/schemas";
import { auditFromReq } from "@/lib/audit/log";

export const GET = withApi({ scope: "projects:read" }, async (_req, { params, api }) => {
  const project = await prisma.project.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    include: {
      client: { select: { id: true, name: true } },
      _count: { select: { tasks: true, members: true } }
    }
  });
  if (!project) throw new ApiError(404, "not_found", "Proyecto no encontrado");
  return NextResponse.json(project);
});

export const PATCH = withApi({ scope: "projects:write" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => null);
  const parsed = projectCreateSchema.partial().safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const result = await prisma.project.updateMany({
    where: { id: params.id, workspaceId: api.workspaceId },
    data: parsed.data
  });
  if (result.count === 0) throw new ApiError(404, "not_found", "Proyecto no encontrado");
  return NextResponse.json(await prisma.project.findUnique({ where: { id: params.id } }));
});

/**
 * SOFT-delete de proyecto. Requiere admin del workspace. Doble
 * confirmación: ?confirm=<id> debe coincidir + el frontend pide
 * type-to-confirm (escribir el nombre exacto). El proyecto queda con
 * deletedAt poblado y desaparece de las queries normales (todas
 * filtran por deletedAt:null). Sus tareas no se tocan automáticamente
 * — siguen pertenenciéndole pero también quedarán ocultas via la
 * relación.
 *
 * Para recuperar: POST /api/v1/trash/project/[id].
 * Para purga definitiva (cascade real): DELETE /api/v1/trash/project/[id]
 * o el cron /api/cron/trash-purge que limpia >30 días.
 *
 * Para liberar las tareas a otro proyecto ANTES de borrar, el cliente
 * llama primero a /api/v1/projects/[id]/move-tasks con el id destino.
 */
const confirmSchema = z.object({
  confirmId: z.string().min(1),
  reason: z.string().optional()
});

export const DELETE = withApi({ scope: "projects:write" }, async (req, { params, api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const me = await prisma.membership.findFirst({
    where: { workspaceId: api.workspaceId, userId: api.userId }
  });
  if (!me || me.role !== "ADMIN") {
    throw new ApiError(403, "forbidden", "Solo admins pueden eliminar proyectos");
  }

  const url = new URL(req.url);
  let confirmId = url.searchParams.get("confirm");
  if (!confirmId) {
    const body = await req.json().catch(() => ({}));
    const parsed = confirmSchema.safeParse(body);
    if (parsed.success) confirmId = parsed.data.confirmId;
  }
  if (confirmId !== params.id) {
    throw new ApiError(
      400,
      "confirm_mismatch",
      "Borrado bloqueado por seguridad: el confirmId no coincide con el id del proyecto"
    );
  }

  const project = await prisma.project.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null },
    include: { _count: { select: { tasks: { where: { deletedAt: null } } } } }
  });
  if (!project) throw new ApiError(404, "not_found", "Proyecto no encontrado");

  await prisma.project.update({
    where: { id: project.id },
    data: { deletedAt: new Date(), deletedById: api.userId }
  });

  auditFromReq(req, api, {
    action: "project.soft_delete",
    targetType: "PROJECT",
    targetId: project.id,
    before: { name: project.name, tasksCount: project._count.tasks },
    meta: { recoverableFor: "30 days" }
  });

  return NextResponse.json({
    ok: true,
    deleted: { id: project.id, name: project.name, tasksSoftDeleted: project._count.tasks },
    restoreUrl: `/admin/papelera`
  });
});
