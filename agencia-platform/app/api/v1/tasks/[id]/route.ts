import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { taskCreateSchema } from "@/lib/api/schemas";

export const GET = withApi({ scope: "tasks:read" }, async (_req, { params, api }) => {
  const task = await prisma.task.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    include: {
      project: true,
      client: true,
      assignees: { include: { user: true } },
      tags: { include: { tag: true } },
      subtasks: true,
      comments: { include: { author: true }, orderBy: { createdAt: "asc" } }
    }
  });
  if (!task) throw new ApiError(404, "not_found", "Tarea no encontrada");
  return NextResponse.json(task);
});

export const PATCH = withApi({ scope: "tasks:write" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => null);
  const parsed = taskCreateSchema.partial().safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const { assigneeIds, dueDate, ...data } = parsed.data;

  const result = await prisma.$transaction(async (tx) => {
    const upd = await tx.task.updateMany({
      where: { id: params.id, workspaceId: api.workspaceId },
      data: {
        ...data,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        completedAt: data.status === "DONE" ? new Date() : data.status ? null : undefined
      }
    });
    if (upd.count === 0) return null;
    if (assigneeIds) {
      await tx.taskAssignee.deleteMany({ where: { taskId: params.id } });
      await tx.taskAssignee.createMany({
        data: assigneeIds.map((uid) => ({ taskId: params.id, userId: uid }))
      });
    }
    return tx.task.findUnique({ where: { id: params.id }, include: { assignees: true } });
  });

  if (!result) throw new ApiError(404, "not_found", "Tarea no encontrada");
  return NextResponse.json(result);
});

export const DELETE = withApi({ scope: "tasks:write" }, async (_req, { params, api }) => {
  const del = await prisma.task.deleteMany({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  if (del.count === 0) throw new ApiError(404, "not_found", "Tarea no encontrada");
  return NextResponse.json({ ok: true });
});
