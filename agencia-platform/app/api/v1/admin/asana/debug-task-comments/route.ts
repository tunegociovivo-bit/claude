/**
 * GET /api/v1/admin/asana/debug-task-comments?localTaskId=NNN
 *
 * Devuelve los comentarios CRUDOS guardados en BD para una tarea
 * local, sin la lazy migration ni el enriquecimiento que hace el
 * endpoint normal. Sirve para diagnosticar por qué los comentarios
 * importados de Asana aparecen vacíos en la UI.
 *
 * Si pasamos `localTaskId`, devuelve directamente esos comentarios.
 * Si pasamos `asanaTaskGid`, busca primero la tarea local con ese
 * asanaId y devuelve sus comentarios.
 *
 * Output por comentario:
 *   - id, asanaId, createdAt
 *   - body (string crudo)
 *   - bodyJson (objeto crudo, sin re-procesar)
 *   - bodyLength, bodyJsonNodes (resumen rápido)
 *   - author info
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");

  const url = new URL(req.url);
  const localTaskId = url.searchParams.get("localTaskId");
  const asanaTaskGid = url.searchParams.get("asanaTaskGid");

  let taskId = localTaskId;
  if (!taskId && asanaTaskGid) {
    const t = await prisma.task.findFirst({
      where: { workspaceId: api.workspaceId, asanaId: asanaTaskGid },
      select: { id: true }
    });
    if (!t) throw new ApiError(404, "no_task", "Tarea no encontrada por asanaId");
    taskId = t.id;
  }
  if (!taskId) throw new ApiError(400, "missing", "Pasa localTaskId o asanaTaskGid");

  const task = await prisma.task.findFirst({
    where: { id: taskId, workspaceId: api.workspaceId },
    select: { id: true, title: true, asanaId: true, deletedAt: true }
  });
  if (!task) throw new ApiError(404, "not_found", "Tarea no existe en este workspace");

  const comments = await prisma.comment.findMany({
    where: { workspaceId: api.workspaceId, targetType: "TASK", targetId: taskId },
    include: { author: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" }
  });

  return NextResponse.json({
    task,
    commentCount: comments.length,
    comments: comments.map((c: any) => {
      const bodyJson = c.bodyJson as any;
      let bodyJsonSummary: any = null;
      if (bodyJson?.type === "doc" && Array.isArray(bodyJson.content)) {
        const nodeTypes: Record<string, number> = {};
        const collectTypes = (n: any) => {
          if (!n) return;
          if (n.type) nodeTypes[n.type] = (nodeTypes[n.type] || 0) + 1;
          if (Array.isArray(n.content)) n.content.forEach(collectTypes);
        };
        collectTypes(bodyJson);
        bodyJsonSummary = {
          topLevelNodes: bodyJson.content.length,
          nodeCounts: nodeTypes,
          hasImages: (nodeTypes.image ?? 0) > 0
        };
      }
      return {
        id: c.id,
        asanaId: c.asanaId,
        createdAt: c.createdAt,
        author: c.author,
        bodyLength: (c.body ?? "").length,
        body: c.body,
        bodyJson,
        bodyJsonSummary,
        bodyJsonIsNull: c.bodyJson === null,
        bodyJsonType: typeof c.bodyJson
      };
    })
  });
});
