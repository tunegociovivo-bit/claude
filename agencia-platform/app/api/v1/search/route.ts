import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

/**
 * Búsqueda global usada por el Cmd+K. Devuelve hasta ~20 hits
 * mezclados (tareas, clientes, proyectos, documentos) que matchean
 * por título/nombre con un ILIKE %q%. Es deliberadamente simple:
 * cuando crezca el histórico, esto se convierte en un buscador
 * semántico con embeddings (pgvector). Hasta entonces, ILIKE va
 * sobrado para ~10k tareas.
 *
 * Respeta workspace y el filtro de proyectos por permisos: un
 * MEMBER no debería ver tareas/proyectos en los que no participa.
 */
export const GET = withApi({ scope: "tasks:read" }, async (req, { api }) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ items: [] });

  // Filtro de visibilidad de proyectos para no-admins
  let projectVisibility: any = undefined;
  if (api.userId) {
    const m = await prisma.membership.findFirst({
      where: { workspaceId: api.workspaceId, userId: api.userId }
    });
    if (m && m.role !== "ADMIN") {
      projectVisibility = {
        OR: [
          { members: { some: { userId: api.userId } } },
          { members: { none: {} } }
        ]
      };
    }
  }

  const where = { workspaceId: api.workspaceId };
  const text = { contains: q, mode: "insensitive" as const };

  const [tasks, clients, projects, documents] = await Promise.all([
    prisma.task.findMany({
      where: {
        ...where,
        title: text,
        deletedAt: null,
        ...(projectVisibility ? { project: projectVisibility } : {})
      } as any,
      take: 6,
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, client: { select: { name: true } } }
    }),
    prisma.client.findMany({
      where: { ...where, name: text, deletedAt: null },
      take: 6,
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true }
    }),
    prisma.project.findMany({
      where: { ...where, name: text, deletedAt: null, ...(projectVisibility ?? {}) } as any,
      take: 6,
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, client: { select: { name: true } } }
    }),
    prisma.document.findMany({
      where: { ...where, title: text, deletedAt: null } as any,
      take: 6,
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true }
    })
  ]);

  const items = [
    ...tasks.map((t) => ({
      kind: "task" as const,
      id: t.id,
      title: t.title,
      clientName: t.client?.name
    })),
    ...clients.map((c) => ({ kind: "client" as const, id: c.id, name: c.name })),
    ...projects.map((p) => ({
      kind: "project" as const,
      id: p.id,
      name: p.name,
      clientName: p.client?.name
    })),
    ...documents.map((d) => ({ kind: "document" as const, id: d.id, title: d.title }))
  ];

  return NextResponse.json({ items });
});
