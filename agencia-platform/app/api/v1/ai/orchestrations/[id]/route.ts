/**
 * GET /api/v1/ai/orchestrations/[id]  (Slice 2c — panel de progreso por tarea)
 *
 * Devuelve el estado del orquestador: plan, estado, intentos, evidencia, coste
 * estimado/real y modelos/proveedores usados. Scoped por workspace. NO expone PII
 * sensible: se omite el texto crudo de error (solo clase de diagnóstico) y las
 * evidencias se pasan tal cual (se guardan ya saneadas). Kill-switch:
 * AI_RUN_ORCHESTRATOR off → 404.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { orchestratorEnabled } from "@/lib/ai/orchestrator/flags";
import { getOrchestration } from "@/lib/ai/orchestrator/store";
import { STATE_LABEL, isOrchState } from "@/lib/ai/orchestrator/state-machine";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "tasks:read" }, async (_req, { api, params }) => {
  if (!orchestratorEnabled()) {
    return NextResponse.json({ error: { code: "disabled", message: "Orquestador desactivado" } }, { status: 404 });
  }
  const id = String((params as any)?.id ?? "");
  const orch = await getOrchestration(prisma, api.workspaceId, id);
  if (!orch) {
    return NextResponse.json({ error: { code: "not_found", message: "Orquestación no encontrada" } }, { status: 404 });
  }

  // Pasos (append-only), scoped por workspace. Se expone SIN el error crudo.
  const steps = await prisma.aiRunStep.findMany({
    where: { workspaceId: api.workspaceId, orchestrationId: id },
    orderBy: { seq: "asc" },
    select: { seq: true, phase: true, strategy: true, provider: true, model: true, ok: true, diagnosis: true, costUsd: true, tokensIn: true, tokensOut: true, fingerprint: true, evidence: true, createdAt: true }
  });

  const usage = (orch.usage as any) ?? { attempts: 0, elapsedMs: 0, tokens: 0, costUsd: 0 };
  const realCost = steps.reduce((s: number, x: any) => s + (x.costUsd ? Number(x.costUsd) : 0), 0);
  const providers = [...new Set(steps.map((s: any) => s.provider).filter(Boolean))];
  const models = [...new Set(steps.map((s: any) => s.model).filter(Boolean))];

  return NextResponse.json({
    id: orch.id,
    taskId: orch.taskId,
    state: orch.state,
    stateLabel: isOrchState(orch.state) ? STATE_LABEL[orch.state] : orch.state,
    mode: orch.mode,
    strategy: orch.strategy,
    plan: orch.plan ?? null,
    attempts: usage.attempts ?? 0,
    cost: { estimatedUsd: usage.costUsd ?? 0, realUsd: Math.round(realCost * 1e4) / 1e4 },
    tokens: usage.tokens ?? 0,
    providersUsed: providers,
    modelsUsed: models,
    decision: orch.decision ?? null, // decision packet (human-facing, sin PII)
    steps: steps.map((s: any) => ({
      seq: s.seq,
      phase: s.phase,
      strategy: s.strategy,
      provider: s.provider,
      model: s.model,
      ok: s.ok,
      diagnosis: s.diagnosis,
      costUsd: s.costUsd ? Number(s.costUsd) : null,
      tokensIn: s.tokensIn,
      tokensOut: s.tokensOut,
      evidence: s.evidence ?? null,
      at: s.createdAt
    }))
  });
});
