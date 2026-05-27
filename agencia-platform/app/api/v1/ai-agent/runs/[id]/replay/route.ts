/**
 * POST /api/v1/ai-agent/runs/:id/replay
 *
 * Re-ejecuta un run pasado: crea un AiAgentRun nuevo con el mismo
 * taskId y triggerContext del original, opcionalmente con modelo
 * distinto o contexto adicional. Útil para:
 *   - Verificar si un bug ya está arreglado tras un fix (sin tener
 *     que recordar qué task era).
 *   - Regresión: replay de los últimos N runs tras tocar una tool.
 *   - A/B test rápido: mismo input, modelo Opus vs Sonnet.
 *
 * Body opcional:
 *   { model?: string,                  // override del modelo
 *     extraContext?: string,           // se concatena al triggerContext original
 *     reason?: string                  // para audit log
 *   }
 *
 * Solo admins (scope:"admin"). Si la task ya tiene un PENDING/RUNNING,
 * no crea otro — devuelve el existente.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { processRunInBackground } from "@/lib/ai/nv-ia/process-run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withApi(
  { scope: "admin" },
  async (req, { api, params }) => {
    const runId = String(params?.id ?? "");
    if (!runId) throw new ApiError(400, "missing_id", "runId requerido");

    const original = await prisma.aiAgentRun.findFirst({
      where: { id: runId, workspaceId: api.workspaceId },
      select: {
        id: true,
        taskId: true,
        triggerContext: true,
        model: true,
        requesterId: true
      }
    });
    if (!original) {
      throw new ApiError(404, "run_not_found", `run ${runId} no encontrado`);
    }

    const body = await req.json().catch(() => ({}));
    const modelOverride =
      typeof body?.model === "string" && body.model.trim()
        ? body.model.trim()
        : null;
    const extraContext =
      typeof body?.extraContext === "string" && body.extraContext.trim()
        ? body.extraContext.trim()
        : null;
    const reason =
      typeof body?.reason === "string" && body.reason.trim()
        ? body.reason.trim()
        : "replay manual desde admin";

    // Dedupe: si la task ya tiene PENDING/RUNNING, no duplicar
    const inFlight = await prisma.aiAgentRun.findFirst({
      where: {
        workspaceId: api.workspaceId,
        taskId: original.taskId,
        status: { in: ["PENDING", "RUNNING"] }
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true }
    });
    if (inFlight) {
      return NextResponse.json({
        ok: true,
        deduped: true,
        runId: inFlight.id,
        status: inFlight.status,
        message: "La task ya tiene un run activo — no se duplica."
      });
    }

    const triggerContext = [
      original.triggerContext ?? null,
      `[Replay del run ${original.id} — ${reason}]`,
      extraContext
    ]
      .filter(Boolean)
      .join("\n\n");

    const newRun = await prisma.aiAgentRun.create({
      data: {
        workspaceId: api.workspaceId,
        taskId: original.taskId,
        requesterId: api.userId ?? original.requesterId ?? null,
        status: "PENDING",
        trigger: "MANUAL" as any,
        triggerContext,
        model: modelOverride ?? original.model
      },
      select: { id: true, taskId: true, model: true }
    });

    processRunInBackground(newRun.id);

    return NextResponse.json({
      ok: true,
      runId: newRun.id,
      taskId: newRun.taskId,
      model: newRun.model,
      originalRunId: original.id
    });
  }
);
