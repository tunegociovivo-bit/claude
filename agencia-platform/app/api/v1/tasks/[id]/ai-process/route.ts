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
import { processRunInBackground } from "@/lib/ai/nv-ia/process-run";
import { planFutureInstructions } from "@/lib/ai/nv-ia/future-instructions";

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

  // «Pedir a Sonia» usa primero el planificador persistente. No dejamos que
  // el agente afirme que creó N followups si no existen realmente en BD.
  // El planificador de instrucciones futuras es una mejora auxiliar. Si el
  // proveedor de IA, su tabla de auditoría o cualquier dependencia temporal
  // falla, la petición principal debe seguir llegando a Sonia: antes una
  // excepción aquí devolvía un 500 y dejaba la tarea sin procesar.
  try {
    const latestRequest = await prisma.comment.findFirst({
      where: { workspaceId: api.workspaceId, targetType: "TASK", targetId: params.id, authorId: api.userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, body: true }
    });
    if (latestRequest?.body) {
      const planned = await planFutureInstructions({
        workspaceId: api.workspaceId,
        taskId: params.id,
        commentId: latestRequest.id,
        commentText: latestRequest.body
      });
      if (planned && !planned.immediateWork && (planned.scheduled > 0 || planned.problems > 0 || planned.alreadyProcessed)) {
        return NextResponse.json({
          ok: true,
          planned: true,
          scheduled: planned.scheduled,
          problems: planned.problems,
          alreadyProcessed: planned.alreadyProcessed,
          message: planned.alreadyProcessed
            ? "La petición futura ya estaba persistida; no se ha duplicado."
            : `Plan persistido y validado: ${planned.scheduled} ejecución(es) programada(s).`
        });
      }
    }
  } catch (error: any) {
    console.error("[ai-process] planificador futuro no disponible; continúa el run normal", {
      taskId: params.id,
      workspaceId: api.workspaceId,
      error: String(error?.message ?? error)
    });
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
    // Si está PENDING (legado de antes de que tuviéramos background
    // trigger, o porque el cron no corre), DISPARARLO ahora —
    // es lo que quiere el user al pulsar el botón "Pedir a Sonia".
    // Si está RUNNING, solo informamos (algo lo está procesando ya).
    if (inFlight.status === "PENDING") {
      processRunInBackground(inFlight.id);
      return NextResponse.json({
        ok: true,
        deduped: true,
        kicked: true,
        runId: inFlight.id,
        status: inFlight.status,
        message: `Run PENDING despertado. Sonia arranca ya.`
      });
    }
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
    // Background trigger en el propio proceso. No depende del cron
    // externo, que en Railway ahora mismo no está configurado.
    processRunInBackground(run.id);
    return NextResponse.json({
      ok: true,
      runId: run.id,
      status: "PENDING",
      message: "Run encolado. Sonia arranca ya en background."
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
