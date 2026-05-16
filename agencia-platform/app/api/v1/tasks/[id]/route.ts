import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { taskCreateSchema } from "@/lib/api/schemas";
import { notifyAssignment } from "@/lib/notifications/assignment";
import { notifyNewMentions } from "@/lib/notifications/mentions-in-doc";
import { auditFromReq } from "@/lib/audit/log";
import { dispatchWebhook } from "@/lib/webhooks/dispatch";

export const GET = withApi({ scope: "tasks:read" }, async (_req, { params, api }) => {
  const task = await prisma.task.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null } as any,
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
  const { assigneeIds, dueDate, dueAllDay, projectIds, notifyDueRules, ...data } = parsed.data;
  // projectIds → si llega, projectIds[0] es el principal, resto va a TaskProject.
  let primaryProjectId: string | undefined;
  let extraProjectIds: string[] | undefined;
  if (projectIds) {
    primaryProjectId = projectIds[0];
    extraProjectIds = projectIds.slice(1).filter((p) => p && p !== primaryProjectId);
  }

  // Para notificar assignees añadidos en esta PATCH, leemos los
  // anteriores antes de tocarlos.
  const prevAssignees = assigneeIds
    ? await prisma.taskAssignee.findMany({
        where: { taskId: params.id },
        select: { userId: true }
      })
    : [];
  const prevAssigneeIds = new Set(prevAssignees.map((a) => a.userId));

  // Si llega `description` nueva, también capturamos la anterior para
  // calcular las menciones nuevas (diff de @user mentions).
  const prevDescription =
    data.description !== undefined
      ? await prisma.task.findUnique({
          where: { id: params.id },
          select: { description: true }
        })
      : null;

  const result = await prisma.$transaction(async (tx) => {
    const upd = await tx.task.updateMany({
      where: { id: params.id, workspaceId: api.workspaceId },
      data: {
        ...data,
        ...(primaryProjectId ? { projectId: primaryProjectId } : {}),
        dueDate: dueDate ? new Date(dueDate) : undefined,
        ...(typeof dueAllDay === "boolean" ? { dueAllDay } : {}),
        ...(notifyDueRules !== undefined ? { notifyDueRules: notifyDueRules as any } : {}),
        completedAt: data.status === "DONE" ? new Date() : data.status ? null : undefined
      } as any
    });
    if (upd.count === 0) return null;
    if (assigneeIds) {
      await tx.taskAssignee.deleteMany({ where: { taskId: params.id } });
      await tx.taskAssignee.createMany({
        data: assigneeIds.map((uid) => ({ taskId: params.id, userId: uid }))
      });
    }
    if (extraProjectIds !== undefined) {
      await (tx as any).taskProject.deleteMany({ where: { taskId: params.id } });
      if (extraProjectIds.length > 0) {
        await (tx as any).taskProject.createMany({
          data: extraProjectIds.map((projectId) => ({ taskId: params.id, projectId }))
        });
      }
    }
    return tx.task.findUnique({ where: { id: params.id }, include: { assignees: true } });
  });

  if (!result) throw new ApiError(404, "not_found", "Tarea no encontrada");

  // Notificar a los assignees AÑADIDOS (no a los que ya estaban). Si
  // assigneeIds no llegó en el body, no se tocaron — no notificamos.
  if (assigneeIds) {
    const added = assigneeIds.filter((id) => !prevAssigneeIds.has(id));
    if (added.length > 0) {
      notifyAssignment({
        taskId: params.id,
        taskTitle: result.title,
        newAssigneeIds: added,
        actorId: api.userId
      }).catch((e) => console.warn("[notif] assignment patch:", e?.message ?? e));
    }
  }
  // Notif por @menciones nuevas en la descripción rich.
  if (data.description !== undefined) {
    notifyNewMentions({
      source: { kind: "task", id: params.id, title: result.title, workspaceId: api.workspaceId },
      previousBody: prevDescription?.description,
      nextBody: data.description,
      actorId: api.userId
    }).catch((e) => console.warn("[notif] mention task desc:", e?.message ?? e));
  }
  dispatchWebhook(api.workspaceId, "task.updated", {
    id: params.id,
    title: result.title,
    status: result.status,
    changedFields: Object.keys(data)
  });
  return NextResponse.json(result);
});

export const DELETE = withApi({ scope: "tasks:write" }, async (req, { params, api }) => {
  // Soft-delete: marcamos deletedAt en vez de borrar. Recuperable
  // desde /admin/papelera durante 30 días; el cron purga después.
  const snapshot = await prisma.task.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null },
    select: { title: true, status: true, projectId: true, clientId: true }
  });
  const del = await prisma.task.updateMany({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null },
    data: { deletedAt: new Date(), deletedById: api.userId ?? undefined } as any
  });
  if (del.count === 0) throw new ApiError(404, "not_found", "Tarea no encontrada");
  auditFromReq(req, api, {
    action: "task.delete",
    targetType: "TASK",
    targetId: params.id,
    before: snapshot,
    meta: { soft: true }
  });
  dispatchWebhook(api.workspaceId, "task.deleted", {
    id: params.id,
    title: snapshot?.title
  });
  return NextResponse.json({ ok: true });
});
