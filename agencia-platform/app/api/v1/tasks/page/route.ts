/**
 * GET /api/v1/tasks/page  (FASE 2 · objetivo 1)
 *
 * Tareas top-level paginadas por cursor (updatedAt desc, id), respetando la
 * visibilidad por usuario. SELECT mínimo para vista de lista. count opcional.
 * Aditivo: no cambia getTasksForUi (SSR del tablón).
 *
 * Query: limit(<=100), cursor, projectId, status, withCount=1
 * Respuesta: { items:[{id,title,status,projectId,priority,updatedAt}], nextCursor, total? }
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { taskVisibilityWhere } from "@/lib/api/task-access";
import { parseTaskPageParams, taskPageFindArgs, taskPageCountWhere, toTaskPageResult } from "@/lib/db/task-page";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "tasks:read" }, async (req, { api }) => {
  const p = parseTaskPageParams(new URL(req.url).searchParams);
  const visibility = await taskVisibilityWhere(api.workspaceId, api.userId ?? null);

  const withCount = new URL(req.url).searchParams.get("withCount") === "1";
  const [rows, total] = await Promise.all([
    prisma.task.findMany(taskPageFindArgs(api.workspaceId, p, visibility as any) as any) as Promise<any[]>,
    withCount
      ? prisma.task.count({ where: taskPageCountWhere(api.workspaceId, p, visibility as any) as any })
      : Promise.resolve(undefined)
  ]);

  return NextResponse.json(toTaskPageResult(rows, p.limit, total as number | undefined));
});
