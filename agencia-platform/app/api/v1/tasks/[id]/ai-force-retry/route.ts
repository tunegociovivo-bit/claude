/**
 * POST /api/v1/tasks/:id/ai-force-retry
 *
 * Mata cualquier run de Sonia en PENDING/RUNNING para esta task,
 * lo marca FAILED con motivo "abortado manualmente", y crea un run
 * NUEVO que arranca inmediatamente.
 *
 * Pensado para: cuando Sonia se queda colgada (RUNNING sin avanzar
 * durante mucho rato) y el user no puede esperar al watchdog
 * automático de 3 minutos.
 *
 * Solo el user con acceso a la task puede usarlo (mismo scope que
 * el botón "Pedir a Sonia"). Idempotente: si no había run colgado,
 * simplemente crea uno nuevo.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { processRunInBackground } from "@/lib/ai/nv-ia/process-run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withApi({ scope: "tasks:write" }, async (_req, { params, api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");

  const task = await prisma.task.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null } as any,
    select: { id: true }
  });
  if (!task) throw new ApiError(404, "not_found", "Tarea no encontrada");

  // Mata los runs in-flight (PENDING/RUNNING) de esta task.
  const aborted = await prisma.aiAgentRun.updateMany({
    where: {
      workspaceId: api.workspaceId,
      taskId: params.id,
      status: { in: ["PENDING", "RUNNING"] }
    },
    data: {
      status: "FAILED",
      error: `Abortado manualmente por user ${api.userId} via force-retry. Probablemente el run se quedó colgado.`,
      finishedAt: new Date()
    }
  });

  // Crea un run nuevo y lo dispara inmediatamente.
  const run = await prisma.aiAgentRun.create({
    data: {
      workspaceId: api.workspaceId,
      taskId: params.id,
      requesterId: api.userId,
      status: "PENDING",
      trigger: "MANUAL" as any,
      triggerContext: aborted.count > 0
        ? `Force-retry tras matar ${aborted.count} run(s) colgado(s).`
        : "Force-retry manual del user."
    }
  });
  processRunInBackground(run.id);

  return NextResponse.json({
    ok: true,
    aborted: aborted.count,
    runId: run.id,
    status: "PENDING",
    message:
      aborted.count > 0
        ? `Matado ${aborted.count} run(s) colgado(s). Nuevo run arrancando.`
        : "Run nuevo arrancando."
  });
});
