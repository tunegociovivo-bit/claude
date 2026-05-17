/**
 * POST /api/v1/tasks/:id/ai-process
 *
 * Dispara A MANO una ejecución de Sonia sobre esta tarea — bypass del
 * dedupe del hook de "compartir con el buzón" y bypass de la latencia
 * del cron. Útil cuando:
 *   - El user ya enlazó la tarea al inbox antes y quiere re-procesar.
 *   - El cron va lento o no está configurado.
 *   - Quiere ver el resultado inmediatamente y no esperar 1-2 min.
 *
 * Si ?inline=1 (default), ejecuta el run SÍNCRONAMENTE en esta request
 * y devuelve el resultado. maxDuration=600s permite agent loops largos.
 *
 * Si ?inline=0, simplemente crea el AiAgentRun en PENDING y deja que
 * el cron lo procese (comportamiento clásico).
 *
 * Requiere: workspace con aiAgent configurado (admin/sonia → init).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { executeAgentRun, loadAgentConfig } from "@/lib/ai/nv-ia/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

export const POST = withApi({ scope: "tasks:write" }, async (req, { params, api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");

  const task = await prisma.task.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null } as any,
    select: { id: true, title: true }
  });
  if (!task) throw new ApiError(404, "not_found", "Tarea no encontrada");

  const ws = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { settings: true }
  });
  const aiCfg = (ws?.settings as any)?.aiAgent;
  if (!aiCfg?.userId || !aiCfg?.inboxProjectId) {
    throw new ApiError(
      400,
      "ai_agent_not_configured",
      "Sonia no está configurada en este workspace. Ve a /admin/nv-ia y pulsa 'Inicializar'."
    );
  }

  const url = new URL(req.url);
  const inline = url.searchParams.get("inline") !== "0";

  // Evitar duplicar trabajo si ya hay un run en curso para esta task.
  const inFlight = await prisma.aiAgentRun.findFirst({
    where: {
      workspaceId: api.workspaceId,
      taskId: params.id,
      status: { in: ["PENDING", "RUNNING"] }
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, createdAt: true }
  });
  if (inFlight) {
    return NextResponse.json({
      ok: true,
      deduped: true,
      runId: inFlight.id,
      status: inFlight.status,
      message: `Ya hay un run ${inFlight.status} en curso para esta tarea.`
    });
  }

  const run = await prisma.aiAgentRun.create({
    data: {
      workspaceId: api.workspaceId,
      taskId: params.id,
      requesterId: api.userId,
      status: inline ? "RUNNING" : "PENDING",
      startedAt: inline ? new Date() : null,
      trigger: "MANUAL" as any
    }
  });

  if (!inline) {
    return NextResponse.json({
      ok: true,
      runId: run.id,
      status: "PENDING",
      message: "Run encolado. El cron lo procesará en 1-2 min."
    });
  }

  // Inline: ejecutamos aquí y devolvemos resultado completo.
  try {
    const config = await loadAgentConfig(api.workspaceId);
    const result = await executeAgentRun({
      workspaceId: api.workspaceId,
      taskId: params.id,
      config,
      runId: run.id,
      trigger: "MANUAL" as any,
      triggerContext: null
    });
    await prisma.aiAgentRun.update({
      where: { id: run.id },
      data: {
        status: result.status as any,
        summary: result.summary,
        error: result.error,
        log: result.log as any,
        stepsCount: result.stepsCount,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        finishedAt: new Date()
      }
    });
    return NextResponse.json({
      ok: true,
      runId: run.id,
      status: result.status,
      summary: result.summary,
      error: result.error,
      stepsCount: result.stepsCount
    });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    await prisma.aiAgentRun
      .update({
        where: { id: run.id },
        data: { status: "FAILED", error: msg, finishedAt: new Date() }
      })
      .catch(() => {});
    return NextResponse.json(
      { ok: false, runId: run.id, status: "FAILED", error: msg },
      { status: 200 }
    );
  }
});
