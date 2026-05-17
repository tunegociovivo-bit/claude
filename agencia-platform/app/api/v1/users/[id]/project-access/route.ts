/**
 * Acceso por proyecto de un miembro del workspace.
 *
 * GET  → lista TODOS los proyectos del workspace, indicando si el
 *        usuario está asignado (hasMember) y si el proyecto es
 *        "abierto" (sin ningún ProjectMember, accesible por todo el
 *        workspace por compat). Útil para pintar la lista de
 *        checkboxes en "Editar usuario".
 *
 * PUT  → body { projectIds: string[] } → reconcilia ProjectMember
 *        para ese user, dejando exactamente esos projectIds. Los
 *        ProjectMember existentes que NO estén en la lista se borran.
 *
 * Sólo admins del workspace. Si el usuario objetivo es ADMIN,
 * devolvemos un aviso — los ADMIN siempre ven todos los proyectos,
 * no tiene sentido limitarlos por aquí.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

async function requireAdminInWorkspace(workspaceId: string, userId: string) {
  const me = await prisma.membership.findFirst({ where: { workspaceId, userId } });
  if (!me || me.role !== "ADMIN") {
    throw new ApiError(403, "forbidden", "Solo admins del workspace pueden gestionar acceso a proyectos");
  }
}

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  await requireAdminInWorkspace(api.workspaceId, api.userId);

  const target = await prisma.membership.findFirst({
    where: { workspaceId: api.workspaceId, userId: params.id }
  });
  if (!target) throw new ApiError(404, "not_found", "Ese usuario no pertenece al workspace");

  const projects = await prisma.project.findMany({
    where: { workspaceId: api.workspaceId, archived: false, deletedAt: null } as any,
    select: {
      id: true,
      name: true,
      client: { select: { name: true } },
      members: { select: { userId: true } }
    },
    orderBy: { name: "asc" }
  });

  const items = projects.map((p) => {
    const hasAnyMember = p.members.length > 0;
    const hasThisMember = p.members.some((m) => m.userId === params.id);
    return {
      id: p.id,
      name: p.name,
      clientName: p.client?.name ?? null,
      hasMember: hasThisMember,
      // Si NO hay ningún ProjectMember → proyecto "abierto" → todos
      // los miembros del workspace lo ven (legacy compat). Lo
      // marcamos para que la UI lo muestre como "todos tienen acceso".
      isOpenProject: !hasAnyMember
    };
  });

  return NextResponse.json({
    targetRole: target.role,
    // Los ADMIN ven todos los proyectos siempre, este toggle no aplica.
    targetIsAdmin: target.role === "ADMIN",
    items
  });
});

const putSchema = z.object({
  projectIds: z.array(z.string()).max(2000)
});

export const PUT = withApi({ scope: "*" }, async (req, { params, api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  await requireAdminInWorkspace(api.workspaceId, api.userId);

  const target = await prisma.membership.findFirst({
    where: { workspaceId: api.workspaceId, userId: params.id }
  });
  if (!target) throw new ApiError(404, "not_found", "Ese usuario no pertenece al workspace");
  if (target.role === "ADMIN") {
    // No tocamos nada — los ADMIN ya ven todo por definición.
    return NextResponse.json({ ok: true, skipped: "user_is_admin" });
  }

  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  // Solo permitimos asignar proyectos que sean de ESTE workspace.
  const valid = await prisma.project.findMany({
    where: { id: { in: parsed.data.projectIds }, workspaceId: api.workspaceId },
    select: { id: true }
  });
  const validIds = new Set(valid.map((p) => p.id));

  const existing = await prisma.projectMember.findMany({
    where: { userId: params.id, project: { workspaceId: api.workspaceId } },
    select: { projectId: true }
  });
  const existingIds = new Set(existing.map((m) => m.projectId));

  const toAdd = [...validIds].filter((id) => !existingIds.has(id));
  const toRemove = [...existingIds].filter((id) => !validIds.has(id));

  await prisma.$transaction([
    ...toAdd.map((projectId) =>
      prisma.projectMember.create({
        data: { projectId, userId: params.id, role: target.role }
      })
    ),
    ...(toRemove.length > 0
      ? [
          prisma.projectMember.deleteMany({
            where: { userId: params.id, projectId: { in: toRemove } }
          })
        ]
      : [])
  ]);

  return NextResponse.json({
    ok: true,
    added: toAdd.length,
    removed: toRemove.length,
    total: validIds.size
  });
});
