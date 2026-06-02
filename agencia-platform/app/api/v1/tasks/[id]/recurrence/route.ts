import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { computeRecurrenceNext, isValidRecurrence } from "@/lib/tasks/recurrence";

/**
 * Pausa / reanuda la recurrencia de una tarea SIN perder la cadencia.
 *   - pause  → recurrenceNextAt = null. El cron de recurrencia solo dispara
 *              tareas con recurrenceNextAt <= now, así que con null nunca
 *              salta. La cadencia (`recurrence`) se conserva intacta.
 *   - resume → recalcula el próximo slot a partir de la cadencia guardada.
 *
 * Estado resultante: recurrence != "none" && recurrenceNextAt == null = PAUSADA.
 */
export const POST = withApi({ scope: "tasks:write" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => null);
  const action = body?.action;
  if (action !== "pause" && action !== "resume") {
    throw new ApiError(400, "validation_error", "action debe ser 'pause' o 'resume'");
  }

  const task = await prisma.task.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null } as any,
    select: { id: true, recurrence: true, dueDate: true } as any
  });
  if (!task) throw new ApiError(404, "not_found", "Tarea no encontrada");

  const recurrence = (task as any).recurrence as string;
  if (!recurrence || recurrence === "none" || !isValidRecurrence(recurrence)) {
    throw new ApiError(409, "not_recurring", "La tarea no tiene recurrencia configurada.");
  }

  const recurrenceNextAt =
    action === "pause"
      ? null
      : computeRecurrenceNext(recurrence as any, (task as any).dueDate ?? null);

  await prisma.task.update({
    where: { id: params.id },
    data: { recurrenceNextAt } as any
  });

  return NextResponse.json({
    ok: true,
    recurrence,
    paused: action === "pause",
    recurrenceNextAt: recurrenceNextAt ? recurrenceNextAt.toISOString() : null
  });
});
