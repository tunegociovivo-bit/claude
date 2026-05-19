import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { taskCreateSchema } from "@/lib/api/schemas";
import { notifyAssignment } from "@/lib/notifications/assignment";
import { dispatchWebhook } from "@/lib/webhooks/dispatch";
import { indexEntity } from "@/lib/search/embeddings";
import { textForTask } from "@/lib/search/indexers";

export const GET = withApi({ scope: "tasks:read" }, async (req, { api }) => {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const assignee = url.searchParams.get("assigneeId") ?? undefined;
  // Paginación: default 500 (kanban necesita visión amplia pero NO
  // todo). Antes devolvía SIN limit → con 2000+ tasks post-Asana la
  // página de /tareas tardaba 5-10s en cargar y el JSON pesaba MBs.
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 500), 1), 2000);

  const where: any = { workspaceId: api.workspaceId, deletedAt: null };
  if (projectId) {
    // Una tarea puede estar en un proyecto como PRINCIPAL (Task.projectId)
    // o como EXTRA (linkada via TaskProject — feature multi-proyecto).
    // Antes solo filtrábamos por principal, así las tareas compartidas a
    // este proyecto desde otro NUNCA aparecían en su kanban. Bug clásico
    // reportado: "comparto task de 'prueba' a 'NEGOCIO VIVO GENERAL' y
    // no la veo en NEGOCIO".
    where.OR = [
      { projectId },
      { extraProjects: { some: { projectId } } }
    ];
  }
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
    orderBy: [{ status: "asc" }, { dueDate: "asc" }],
    take: limit
  });
  return NextResponse.json({ items, limit });
});

export const POST = withApi({ scope: "tasks:write" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = taskCreateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const { assigneeIds, dueAllDay, projectIds, extraProjectStatuses, notifyDueRules, ...data } = parsed.data;
  // projectIds[0] manda como proyecto principal si llega; si no, projectId.
  const primaryProject = projectIds?.[0] ?? data.projectId;
  const extra = (projectIds ?? []).slice(1).filter((p) => p && p !== primaryProject);
  const epsMap = extraProjectStatuses ?? {};
  const task = await prisma.task.create({
    data: {
      ...data,
      projectId: primaryProject,
      workspaceId: api.workspaceId,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      ...(typeof dueAllDay === "boolean" ? { dueAllDay } : {}),
      ...(notifyDueRules !== undefined ? { notifyDueRules: notifyDueRules as any } : {}),
      assignees: { create: assigneeIds.map((uid) => ({ userId: uid })) },
      ...(extra.length > 0
        ? {
            extraProjects: {
              create: extra.map((projectId) => ({
                projectId,
                status: epsMap[projectId] ?? null
              }))
            }
          }
        : {})
    } as any
  });
  // Notificación a los asignados al crear (excluyendo al actor).
  notifyAssignment({
    taskId: task.id,
    taskTitle: task.title,
    newAssigneeIds: assigneeIds,
    actorId: api.userId
  }).catch((e) => console.warn("[notif] assignment create:", e?.message ?? e));
  // Indexa para búsqueda semántica — fire-and-forget.
  void indexEntity({
    workspaceId: api.workspaceId,
    entityType: "TASK",
    entityId: task.id,
    text: textForTask(task as any)
  }).catch(() => {});
  // Webhook saliente — fire-and-forget.
  dispatchWebhook(api.workspaceId, "task.created", {
    id: task.id,
    title: task.title,
    status: task.status,
    projectId: task.projectId,
    clientId: task.clientId,
    dueDate: task.dueDate,
    assigneeIds
  });
  return NextResponse.json(task, { status: 201 });
});
