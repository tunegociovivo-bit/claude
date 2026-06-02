import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { taskCreateSchema } from "@/lib/api/schemas";
import { computeRecurrenceNext } from "@/lib/tasks/recurrence";
import { notifyAssignment } from "@/lib/notifications/assignment";
import { notifyNewMentions } from "@/lib/notifications/mentions-in-doc";
import { auditFromReq } from "@/lib/audit/log";
import { dispatchWebhook } from "@/lib/webhooks/dispatch";
import { indexEntity, deleteEntityIndex } from "@/lib/search/embeddings";
import { textForTask } from "@/lib/search/indexers";
import { processRunInBackground } from "@/lib/ai/nv-ia/process-run";

export const GET = withApi({ scope: "tasks:read" }, async (_req, { params, api }) => {
  const task = await prisma.task.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null } as any,
    include: {
      project: true,
      client: true,
      assignees: { include: { user: true } },
      tags: { include: { tag: true } },
      subtasks: true
    }
  });
  if (!task) throw new ApiError(404, "not_found", "Tarea no encontrada");
  // Los comentarios son polimórficos (sin FK directo en BD), así que
  // los consultamos aparte por targetType + targetId.
  const comments = await prisma.comment.findMany({
    where: { workspaceId: api.workspaceId, targetType: "TASK", targetId: params.id },
    include: { author: true },
    orderBy: { createdAt: "asc" }
  });
  return NextResponse.json({ ...task, comments });
});

export const PATCH = withApi({ scope: "tasks:write" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => null);
  const parsed = taskCreateSchema.partial().safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const { assigneeIds, dueDate, dueAllDay, projectIds, extraProjectStatuses, notifyDueRules, ...data } =
    parsed.data;
  // projectIds → si llega, projectIds[0] es el principal, resto va a TaskProject.
  let primaryProjectId: string | undefined;
  let extraProjectIds: string[] | undefined;
  if (projectIds) {
    primaryProjectId = projectIds[0];
    extraProjectIds = projectIds.slice(1).filter((p) => p && p !== primaryProjectId);
  }
  const epsMap = extraProjectStatuses ?? {};

  // Para notificar assignees añadidos en esta PATCH, leemos los
  // anteriores antes de tocarlos.
  const prevAssignees = assigneeIds
    ? await prisma.taskAssignee.findMany({
        where: { taskId: params.id },
        select: { userId: true }
      })
    : [];
  const prevAssigneeIds = new Set(prevAssignees.map((a) => a.userId));

  // Igual para extraProjectIds: necesitamos saber qué proyectos extra
  // tenía ANTES de la PATCH para detectar si Sonia acaba de recibir
  // la tarea por primera vez (hook de creación de AiAgentRun más abajo).
  const prevExtraProjectIds =
    extraProjectIds !== undefined
      ? (
          await (prisma as any).taskProject.findMany({
            where: { taskId: params.id },
            select: { projectId: true }
          })
        ).map((r: any) => r.projectId as string)
      : undefined;

  // Si llega `description` nueva, también capturamos la anterior para
  // calcular las menciones nuevas (diff de @user mentions).
  const prevDescription =
    data.description !== undefined
      ? await prisma.task.findUnique({
          where: { id: params.id },
          select: { description: true }
        })
      : null;

  // Recurrencia: solo recalculamos recurrenceNextAt si la CADENCIA cambia.
  // Si llega la misma `recurrence` (el form la reenvía siempre al guardar),
  // dejamos recurrenceNextAt intacto para NO des-pausar una recurrencia que
  // el usuario haya pausado (pausa = recurrenceNextAt:null con la cadencia
  // conservada).
  const prevRecurrence =
    data.recurrence !== undefined
      ? await prisma.task.findUnique({
          where: { id: params.id },
          select: { recurrence: true } as any
        })
      : null;
  const recurrenceChanged =
    data.recurrence !== undefined && data.recurrence !== ((prevRecurrence as any)?.recurrence ?? "none");

  const result = await prisma.$transaction(async (tx) => {
    const upd = await tx.task.updateMany({
      where: { id: params.id, workspaceId: api.workspaceId },
      data: {
        ...data,
        ...(primaryProjectId ? { projectId: primaryProjectId } : {}),
        dueDate: dueDate ? new Date(dueDate) : undefined,
        ...(typeof dueAllDay === "boolean" ? { dueAllDay } : {}),
        ...(notifyDueRules !== undefined ? { notifyDueRules: notifyDueRules as any } : {}),
        ...(recurrenceChanged
          ? {
              recurrenceNextAt:
                data.recurrence === "none"
                  ? null
                  : computeRecurrenceNext(data.recurrence as any, dueDate ? new Date(dueDate) : null)
            }
          : {}),
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
          data: extraProjectIds.map((projectId) => ({
            taskId: params.id,
            projectId,
            status: epsMap[projectId] ?? null
          }))
        });
      }
    } else if (Object.keys(epsMap).length > 0) {
      // El user no cambió la lista de proyectos pero SÍ las columnas
      // de cada uno: actualizamos solo los status que cambian.
      for (const [pid, st] of Object.entries(epsMap)) {
        await (tx as any).taskProject
          .update({
            where: { taskId_projectId: { taskId: params.id, projectId: pid } },
            data: { status: st }
          })
          .catch(() => {});
      }
    }
    return tx.task.findUnique({ where: { id: params.id }, include: { assignees: true } });
  });

  if (!result) throw new ApiError(404, "not_found", "Tarea no encontrada");

  // Sonia: si el humano EDITA la task (PATCH), interpretamos que ya
  // ha "atendido" lo que Sonia hizo — apagamos el parpadeo verde/
  // naranja marcando humanReviewedAt en runs SUCCEEDED/REQUIRES_HUMAN/
  // FAILED no revisados. NO afecta a runs PENDING/RUNNING (todavía
  // está trabajando — el morado sigue).
  // Excepción: si el editor es el propio user de Sonia (porque Sonia
  // hizo update_task_status), NO marcamos como revisado.
  try {
    const ws = await prisma.workspace.findUnique({
      where: { id: api.workspaceId },
      select: { settings: true }
    });
    const sonyaUserId = (ws?.settings as any)?.aiAgent?.userId;
    if (api.userId && api.userId !== sonyaUserId) {
      await prisma.aiAgentRun.updateMany({
        where: {
          taskId: params.id,
          workspaceId: api.workspaceId,
          humanReviewedAt: null,
          status: { in: ["SUCCEEDED", "REQUIRES_HUMAN", "FAILED"] }
        },
        data: { humanReviewedAt: new Date() }
      });
    }
  } catch {}

  // Hook Sonia: si la tarea acaba de enlazarse al proyecto buzón de
  // Sonia, disparamos un AiAgentRun en PENDING. El cron lo recoge.
  // Sólo cuando extraProjectIds llegó EXPLÍCITAMENTE en el body (es
  // decir, el user acaba de añadir/quitar proyectos), y solo si el
  // inboxProjectId está en la nueva lista pero NO estaba en la
  // anterior — para no duplicar runs si tocan otros proyectos extra.
  if (extraProjectIds !== undefined) {
    try {
      const ws = await prisma.workspace.findUnique({
        where: { id: api.workspaceId },
        select: { settings: true }
      });
      const inboxId = (ws?.settings as any)?.aiAgent?.inboxProjectId;
      if (inboxId && extraProjectIds.includes(inboxId)) {
        // ¿Estaba ya en la lista anterior? Si sí, no es "nueva entrada".
        const wasAlreadyLinked = prevExtraProjectIds?.includes(inboxId);
        if (!wasAlreadyLinked) {
          const newRun = await prisma.aiAgentRun.create({
            data: {
              workspaceId: api.workspaceId,
              taskId: params.id,
              requesterId: api.userId ?? null,
              status: "PENDING"
            }
          });
          // Dispara el procesado YA en background — sin esto el run
          // se quedaba en PENDING hasta que algo lo despertara. Como
          // Railway no tiene cron configurado, podía ser horas/nunca.
          processRunInBackground(newRun.id);
        }
      }
    } catch (e) {
      console.warn("[nv-ia] hook create-run failed:", (e as Error).message);
    }
  }

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
  // Re-indexa para semántica si cambiaron campos relevantes.
  if ("title" in data || "description" in data) {
    void indexEntity({
      workspaceId: api.workspaceId,
      entityType: "TASK",
      entityId: params.id,
      text: textForTask({
        title: result.title,
        description: (result as any).description
      })
    }).catch(() => {});
  }
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
  void deleteEntityIndex("TASK", params.id).catch(() => {});
  return NextResponse.json({ ok: true });
});
