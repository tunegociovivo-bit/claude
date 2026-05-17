import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { projectCreateSchema } from "@/lib/api/schemas";

export const GET = withApi({ scope: "projects:read" }, async (req, { api }) => {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId") ?? undefined;
  // Excluimos archived (oculto manual) Y deletedAt (papelera). El DELETE
  // del endpoint es soft-delete a `deletedAt`, así que sin este filtro
  // los proyectos borrados seguirían apareciendo en el tablón hasta que
  // el cron de trash-purge los limpiase a los 30 días.
  const where: any = { workspaceId: api.workspaceId, archived: false, deletedAt: null };
  if (clientId) where.clientId = clientId;

  // Filtrado por permisos: si no eres ADMIN del workspace, sólo ves
  //  (a) proyectos donde estás añadido como ProjectMember
  //  (b) proyectos "abiertos" (sin ningún ProjectMember) — compatibilidad
  //      con proyectos creados antes de existir el sistema de permisos.
  // Las API keys (sin userId) siguen viendo todo del workspace.
  if (api.userId) {
    const membership = await prisma.membership.findFirst({
      where: { workspaceId: api.workspaceId, userId: api.userId }
    });
    if (membership && membership.role !== "ADMIN") {
      where.OR = [
        { members: { some: { userId: api.userId } } },
        { members: { none: {} } }
      ];
    }
  }

  const items = await prisma.project.findMany({
    where,
    include: {
      client: { select: { id: true, name: true } },
      _count: { select: { tasks: true, members: true } }
    },
    orderBy: { createdAt: "desc" }
  });
  return NextResponse.json({ items });
});

export const POST = withApi({ scope: "projects:write" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = projectCreateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const project = await prisma.project.create({ data: { ...parsed.data, workspaceId: api.workspaceId } });
  return NextResponse.json(project, { status: 201 });
});
