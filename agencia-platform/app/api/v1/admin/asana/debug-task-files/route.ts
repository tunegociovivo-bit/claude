/**
 * GET /api/v1/admin/asana/debug-task-files?localTaskId=...
 *  o ?asanaTaskGid=...
 *
 * Diagnóstico: lista TODOS los File records que tenemos en BD
 * relacionados con un task — tanto los enlazados al targetId actual
 * (que la UI muestra) como los que tengan asanaId pero estén
 * apuntando a OTRO targetId (huérfanos de una importación anterior).
 *
 * Útil para responder a "siguen sin verse los adjuntos": vemos si
 * los Files ya están importados (correctamente o huérfanos) o si
 * realmente no se ha llegado a crear ninguno.
 *
 * Solo admin.
 */

import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";
import { prisma } from "@/lib/db/prisma";

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
    taskId = t?.id ?? null;
  }
  if (!taskId) throw new ApiError(400, "missing", "Pasa localTaskId o asanaTaskGid");

  const task = await prisma.task.findFirst({
    where: { id: taskId, workspaceId: api.workspaceId },
    select: { id: true, title: true, asanaId: true }
  });
  if (!task) throw new ApiError(404, "not_found", "Tarea no existe");

  // Files enlazados a ESTE task (los que la UI sí ve)
  const linkedHere = await prisma.file.findMany({
    where: { workspaceId: api.workspaceId, targetType: "TASK", targetId: task.id },
    orderBy: { createdAt: "asc" }
  });

  // Files con asanaId que provienen de adjuntos de ESTE task en Asana
  // (independientemente de a qué task local apunten ahora — pueden
  // estar huérfanos).
  const allByAsanaIdPattern: any[] = [];
  if (task.asanaId) {
    // Sin lista de gids no podemos filtrar por "viene de este task",
    // pero podemos al menos buscar Files cuyo asanaId NO sea null y
    // mostrar el targetId actual para que el admin diagnostique.
    const sample = await prisma.file.findMany({
      where: {
        workspaceId: api.workspaceId,
        asanaId: { not: null }
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        name: true,
        asanaId: true,
        targetType: true,
        targetId: true,
        s3Key: true,
        sizeBytes: true
      }
    });
    allByAsanaIdPattern.push(...sample);
  }

  return NextResponse.json({
    task,
    linkedToThisTaskCount: linkedHere.length,
    linkedToThisTask: linkedHere.map((f) => ({
      id: f.id,
      name: f.name,
      asanaId: f.asanaId,
      mime: f.mimeType,
      size: f.sizeBytes,
      isExternal: f.s3Key?.startsWith("__external__:") ?? false,
      s3KeyPrefix: f.s3Key?.slice(0, 60) ?? null
    })),
    allWorkspaceFilesWithAsanaId_sample: allByAsanaIdPattern
  });
});
