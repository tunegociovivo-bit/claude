import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

async function requireAdminInWorkspace(workspaceId: string, userId: string) {
  const me = await prisma.membership.findFirst({ where: { workspaceId, userId } });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins pueden hacer esto");
}

export const DELETE = withApi({ scope: "projects:write" }, async (_req, { params, api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  await requireAdminInWorkspace(api.workspaceId, api.userId);

  const project = await prisma.project.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  if (!project) throw new ApiError(404, "not_found", "Proyecto no encontrado");

  const result = await prisma.projectMember.deleteMany({
    where: { projectId: params.id, userId: params.userId }
  });
  if (result.count === 0) throw new ApiError(404, "not_found", "Ese usuario no era miembro del proyecto");

  return NextResponse.json({ ok: true });
});
