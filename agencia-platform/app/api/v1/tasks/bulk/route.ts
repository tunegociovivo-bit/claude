/**
 * Acciones en masa sobre tareas seleccionadas.
 * Body:
 *   { ids: string[], action: "delete" | "move_status" | "move_project" | "assign", params: {...} }
 * Devuelve { ok, affected, errors[] }
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { auditFromReq } from "@/lib/audit/log";
import { dispatchWebhook } from "@/lib/webhooks/dispatch";
import { deleteEntityIndex } from "@/lib/search/embeddings";

const baseSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
  action: z.enum(["delete", "move_status", "move_project", "assign"]),
  params: z.record(z.any()).optional()
});

export const POST = withApi({ scope: "tasks:write" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = baseSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const { ids, action, params } = parsed.data;

  // Verificamos que todas las tareas pertenecen al workspace
  const tasks = await prisma.task.findMany({
    where: { id: { in: ids }, workspaceId: api.workspaceId },
    select: { id: true }
  });
  if (tasks.length !== ids.length) {
    throw new ApiError(403, "forbidden", `${ids.length - tasks.length} tareas no pertenecen al workspace`);
  }

  if (action === "delete") {
    // Soft-delete: marcamos deletedAt en vez de borrar físicamente. Antes esto
    // hacía `deleteMany` (borrado FÍSICO) que NO pasaba por la papelera y, por
    // el `onDelete: Cascade` de las subtareas, arrastraba subtareas que el
    // usuario no había seleccionado. Ahora va a la papelera (recuperable 30
    // días) y no toca las subtareas, igual que el borrado individual.
    const before = await prisma.task.findMany({
      where: { id: { in: ids }, workspaceId: api.workspaceId, deletedAt: null } as any,
      select: { id: true, title: true, status: true, projectId: true, clientId: true }
    });
    const r = await prisma.task.updateMany({
      where: { id: { in: ids }, workspaceId: api.workspaceId, deletedAt: null } as any,
      data: { deletedAt: new Date(), deletedById: api.userId ?? undefined } as any
    });
    // Quitamos del índice de búsqueda y dejamos auditoría/webhook, como el
    // borrado individual.
    for (const t of before) {
      void deleteEntityIndex("TASK", t.id).catch(() => {});
      void auditFromReq(req, api, {
        action: "task.delete",
        targetType: "TASK",
        targetId: t.id,
        before: { title: t.title, status: t.status, projectId: t.projectId, clientId: t.clientId },
        meta: { soft: true, bulk: true }
      });
      void dispatchWebhook(api.workspaceId, "task.deleted", { id: t.id, title: t.title });
    }
    return NextResponse.json({ ok: true, affected: r.count });
  }

  if (action === "move_status") {
    const status = (params?.status as string | undefined) ?? "";
    if (!status) throw new ApiError(400, "missing_param", "Falta params.status");
    const isDone = status === "DONE";
    const r = await prisma.task.updateMany({
      where: { id: { in: ids }, workspaceId: api.workspaceId },
      data: { status, completedAt: isDone ? new Date() : null }
    });
    return NextResponse.json({ ok: true, affected: r.count });
  }

  if (action === "move_project") {
    const projectId = (params?.projectId as string | undefined) ?? "";
    if (!projectId) throw new ApiError(400, "missing_param", "Falta params.projectId");
    const project = await prisma.project.findFirst({
      where: { id: projectId, workspaceId: api.workspaceId },
      select: { id: true, clientId: true }
    });
    if (!project) throw new ApiError(404, "not_found", "Proyecto destino no existe");
    const r = await prisma.task.updateMany({
      where: { id: { in: ids }, workspaceId: api.workspaceId },
      data: { projectId: project.id, clientId: project.clientId }
    });
    return NextResponse.json({ ok: true, affected: r.count });
  }

  if (action === "assign") {
    const assigneeIds = (params?.assigneeIds as string[] | undefined) ?? [];
    const mode = ((params?.mode as string | undefined) ?? "replace") as "replace" | "add";
    if (!Array.isArray(assigneeIds)) {
      throw new ApiError(400, "bad_param", "params.assigneeIds debe ser array");
    }

    // En transacción: para cada tarea
    await prisma.$transaction(async (tx) => {
      for (const taskId of ids) {
        if (mode === "replace") {
          await tx.taskAssignee.deleteMany({ where: { taskId } });
        }
        if (assigneeIds.length > 0) {
          // Idempotente vía createMany skipDuplicates en SQL pure;
          // como TaskAssignee tiene unique compuesto (taskId, userId),
          // usamos upsert simple.
          for (const userId of assigneeIds) {
            await tx.taskAssignee.upsert({
              where: { taskId_userId: { taskId, userId } },
              create: { taskId, userId },
              update: {}
            });
          }
        }
      }
    });
    return NextResponse.json({ ok: true, affected: ids.length });
  }

  throw new ApiError(400, "unknown_action", `Acción no soportada: ${action}`);
});
