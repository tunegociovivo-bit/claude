import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { taskCreateSchema } from "@/lib/api/schemas";

export const GET = withApi({ scope: "tasks:read" }, async (req, { api }) => {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const assignee = url.searchParams.get("assigneeId") ?? undefined;

  const where: any = { workspaceId: api.workspaceId };
  if (projectId) where.projectId = projectId;
  if (status) where.status = status;
  if (assignee) where.assignees = { some: { userId: assignee } };

  // Filtrado de tareas por permisos del proyecto (mismo criterio que /projects):
  if (api.userId) {
    const membership = await prisma.membership.findFirst({
      where: { workspaceId: api.workspaceId, userId: api.userId }
    });
    if (membership && membership.role !== "ADMIN") {
      where.project = {
        OR: [
          { members: { some: { userId: api.userId } } },
          { members: { none: {} } }
        ]
      };
    }
  }

  const items = await prisma.task.findMany({
    where,
    include: {
      project: { select: { id: true, name: true, color: true, clientId: true } },
      client: { select: { id: true, name: true } },
      assignees: { include: { user: { select: { id: true, name: true, email: true, image: true } } } },
      tags: { include: { tag: true } }
    },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }]
  });
  return NextResponse.json({ items });
});

export const POST = withApi({ scope: "tasks:write" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = taskCreateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const { assigneeIds, dueAllDay, ...data } = parsed.data;
  const task = await prisma.task.create({
    data: {
      ...data,
      workspaceId: api.workspaceId,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      ...(typeof dueAllDay === "boolean" ? { dueAllDay } : {}),
      assignees: { create: assigneeIds.map((uid) => ({ userId: uid })) }
    } as any
  });
  return NextResponse.json(task, { status: 201 });
});
