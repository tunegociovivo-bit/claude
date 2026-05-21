/**
 * GET /api/v1/search/semantic?q=...&topK=10
 *
 * Búsqueda por significado. Genera un embedding de la query y la
 * compara contra todos los embeddings indexados del workspace.
 *
 * Devuelve resultados hidratados (con el título / nombre de cada
 * entidad) para que el Cmd+K palette pueda pintarlos sin más fetches.
 *
 * Respeta visibilidad de proyectos: un MEMBER no recibe matches de
 * tareas/proyectos a los que no pertenece.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { semanticSearch, type EntityType } from "@/lib/search/embeddings";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "tasks:read" }, async (req, { api }) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 3) return NextResponse.json({ items: [] });
  const topK = Math.min(Math.max(Number(url.searchParams.get("topK") ?? 15), 1), 30);

  // Visibilidad de proyectos para no-admins.
  let allowedProjectIds: Set<string> | null = null;
  if (api.userId) {
    const m = await prisma.membership.findFirst({
      where: { workspaceId: api.workspaceId, userId: api.userId }
    });
    if (m && m.role !== "ADMIN") {
      const allowed = await prisma.project.findMany({
        where: {
          workspaceId: api.workspaceId,
          OR: [
            { members: { some: { userId: api.userId } } },
            { members: { none: {} } }
          ]
        },
        select: { id: true }
      });
      allowedProjectIds = new Set(allowed.map((p) => p.id));
    }
  }

  let hits;
  try {
    hits = await semanticSearch({
      workspaceId: api.workspaceId,
      query: q,
      topK
    });
  } catch (e: any) {
    // Si falla la API de OpenAI (sin key, etc.) devolvemos vacío en
    // lugar de 500 — la UI tiene fallback al ILIKE clásico.
    return NextResponse.json({ items: [], error: e?.message ?? "embedding_failed" });
  }

  // Hidratar: agrupar ids por tipo y hacer un fetch por tipo.
  const byType: Record<EntityType, string[]> = {
    TASK: [],
    CLIENT: [],
    PROJECT: [],
    DOCUMENT: [],
    COMMENT: [],
    SONIA_KNOWLEDGE: []
  };
  for (const h of hits) byType[h.entityType].push(h.entityId);

  const [tasks, clients, projects, documents, comments] = await Promise.all([
    byType.TASK.length
      ? prisma.task.findMany({
          where: { id: { in: byType.TASK }, workspaceId: api.workspaceId, deletedAt: null } as any,
          select: { id: true, title: true, projectId: true, client: { select: { name: true } } }
        })
      : [],
    byType.CLIENT.length
      ? prisma.client.findMany({
          where: { id: { in: byType.CLIENT }, workspaceId: api.workspaceId, deletedAt: null },
          select: { id: true, name: true }
        })
      : [],
    byType.PROJECT.length
      ? prisma.project.findMany({
          where: { id: { in: byType.PROJECT }, workspaceId: api.workspaceId, deletedAt: null } as any,
          select: { id: true, name: true, client: { select: { name: true } } }
        })
      : [],
    byType.DOCUMENT.length
      ? prisma.document.findMany({
          where: { id: { in: byType.DOCUMENT }, workspaceId: api.workspaceId, deletedAt: null } as any,
          select: { id: true, title: true }
        })
      : [],
    byType.COMMENT.length
      ? prisma.comment.findMany({
          where: { id: { in: byType.COMMENT }, workspaceId: api.workspaceId },
          select: { id: true, targetType: true, targetId: true, body: true }
        })
      : []
  ]);

  const taskMap = new Map(tasks.map((x) => [x.id, x]));
  const clientMap = new Map(clients.map((x) => [x.id, x]));
  const projectMap = new Map(projects.map((x) => [x.id, x]));
  const docMap = new Map(documents.map((x) => [x.id, x]));
  const commentMap = new Map(comments.map((x) => [x.id, x]));

  const items = hits
    .map((h) => {
      if (h.entityType === "TASK") {
        const t = taskMap.get(h.entityId);
        if (!t) return null;
        if (allowedProjectIds && !allowedProjectIds.has(t.projectId)) return null;
        return {
          kind: "task" as const,
          id: t.id,
          title: t.title,
          subtitle: t.client?.name ?? null,
          snippet: makeSnippet(h.text, 160),
          score: h.score
        };
      }
      if (h.entityType === "CLIENT") {
        const c = clientMap.get(h.entityId);
        if (!c) return null;
        return {
          kind: "client" as const,
          id: c.id,
          title: c.name,
          subtitle: null,
          snippet: makeSnippet(h.text, 160),
          score: h.score
        };
      }
      if (h.entityType === "PROJECT") {
        const p = projectMap.get(h.entityId);
        if (!p) return null;
        if (allowedProjectIds && !allowedProjectIds.has(p.id)) return null;
        return {
          kind: "project" as const,
          id: p.id,
          title: p.name,
          subtitle: p.client?.name ?? null,
          snippet: makeSnippet(h.text, 160),
          score: h.score
        };
      }
      if (h.entityType === "DOCUMENT") {
        const d = docMap.get(h.entityId);
        if (!d) return null;
        return {
          kind: "document" as const,
          id: d.id,
          title: d.title,
          subtitle: null,
          snippet: makeSnippet(h.text, 160),
          score: h.score
        };
      }
      if (h.entityType === "COMMENT") {
        const c = commentMap.get(h.entityId);
        if (!c) return null;
        // El comentario salta a su tarea/cliente/doc origen.
        return {
          kind: "comment" as const,
          id: c.id,
          parentType: c.targetType,
          parentId: c.targetId,
          title: "(comentario)",
          subtitle: null,
          snippet: makeSnippet(h.text, 200),
          score: h.score
        };
      }
      return null;
    })
    .filter(Boolean);

  return NextResponse.json({ items });
});

function makeSnippet(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max) + "…";
}
