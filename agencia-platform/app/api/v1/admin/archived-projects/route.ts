/**
 * GET / PUT /api/v1/admin/archived-projects
 *
 * Lista proyectos archivados (no devueltos por /api/v1/projects).
 * PUT { projectId, archived } cambia el estado para que el admin
 * pueda recuperar proyectos importados accidentalmente como archivados
 * (típico de imports Asana antes del fix de archived=false default).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "admin" }, async (_req, { api }) => {
  const items = await prisma.project.findMany({
    where: {
      workspaceId: api.workspaceId,
      archived: true,
      deletedAt: null
    } as any,
    select: {
      id: true,
      name: true,
      asanaId: true,
      createdAt: true,
      _count: { select: { tasks: true } }
    },
    orderBy: { createdAt: "desc" }
  });
  return NextResponse.json({ items });
});

export const PUT = withApi({ scope: "admin" }, async (req, { api }) => {
  const body = await req.json().catch(() => ({}));
  const projectId = String(body?.projectId ?? "");
  const archived = !!body?.archived;
  if (!projectId) return NextResponse.json({ error: "projectId requerido" }, { status: 400 });
  const p = await prisma.project.findFirst({
    where: { id: projectId, workspaceId: api.workspaceId }
  });
  if (!p) return NextResponse.json({ error: "no encontrado" }, { status: 404 });
  await prisma.project.update({
    where: { id: projectId },
    data: { archived }
  });
  return NextResponse.json({ ok: true, archived });
});
