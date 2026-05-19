/**
 * GET / PUT /api/v1/admin/archived-projects
 *
 * GET sin params: lista proyectos archivados (no devueltos por
 *   /api/v1/projects).
 * GET ?q=texto: BUSCA por nombre/asanaId en TODOS los proyectos —
 *   sin filtrar por archived/deletedAt. Devuelve el estado completo
 *   (archived, deletedAt) para diagnosticar "no veo X" — el user puede
 *   distinguir entre archivado, borrado y no-existe.
 * PUT { projectId, archived?, restore? } cambia el estado:
 *   - archived=false → des-archivar
 *   - restore=true → quitar deletedAt (recuperar de papelera)
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "admin" }, async (req, { api }) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();

  // Modo búsqueda: TODOS los proyectos (incluso borrados) por nombre/asanaId
  if (q) {
    const items = await prisma.project.findMany({
      where: {
        workspaceId: api.workspaceId,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { asanaId: { contains: q } }
        ]
      } as any,
      select: {
        id: true,
        name: true,
        asanaId: true,
        archived: true,
        deletedAt: true,
        createdAt: true,
        _count: { select: { tasks: true } }
      } as any,
      orderBy: { createdAt: "desc" },
      take: 50
    });
    return NextResponse.json({ items, mode: "search" });
  }

  // Modo default: solo archivados (no borrados)
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
      archived: true,
      deletedAt: true,
      createdAt: true,
      _count: { select: { tasks: true } }
    } as any,
    orderBy: { createdAt: "desc" }
  });
  return NextResponse.json({ items, mode: "archived" });
});

export const PUT = withApi({ scope: "admin" }, async (req, { api }) => {
  const body = await req.json().catch(() => ({}));
  const projectId = String(body?.projectId ?? "");
  if (!projectId) return NextResponse.json({ error: "projectId requerido" }, { status: 400 });
  const p = await prisma.project.findFirst({
    where: { id: projectId, workspaceId: api.workspaceId }
  });
  if (!p) return NextResponse.json({ error: "no encontrado" }, { status: 404 });

  const data: any = {};
  if (typeof body?.archived === "boolean") data.archived = body.archived;
  if (body?.restore === true) {
    data.deletedAt = null;
    data.archived = false; // restaurar también des-archiva, no tiene sentido restaurar archivado
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "nada que cambiar" }, { status: 400 });
  }
  await prisma.project.update({ where: { id: projectId }, data });
  return NextResponse.json({ ok: true, ...data });
});
