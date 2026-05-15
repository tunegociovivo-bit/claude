import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { projectCreateSchema } from "@/lib/api/schemas";

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
 * Borrado de proyecto. Requiere admin del workspace.
 * Acepta query string ?confirm=<id>: el cliente envía el propio id como
 * comprobación de seguridad de "doble consentimiento". Si no coincide,
 * se rechaza. La idea es que el cliente sea explícito y no haya borrados
 * accidentales por scripts.
 *
 * Al borrar: por cascade se eliminan ProjectMember, Task (y sus subtareas,
 * comentarios, asignados). Los Files del workspace que apunten al proyecto
 * quedan sin target (no se cascadean) — los podemos limpiar después si hace
 * falta.
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
  // Confirmación vía query OR body
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
    where: { id: params.id, workspaceId: api.workspaceId },
    include: { _count: { select: { tasks: true } } }
  });
  if (!project) throw new ApiError(404, "not_found", "Proyecto no encontrado");

  await prisma.project.delete({ where: { id: project.id } });

  return NextResponse.json({
    ok: true,
    deleted: { id: project.id, name: project.name, tasksDeleted: project._count.tasks }
  });
});
