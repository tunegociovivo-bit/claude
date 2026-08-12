/**
 * POST /api/v1/ai/orchestrations/tick — ENTRYPOINT del scheduler (cron).
 *
 * Autenticado por CRON (INTERNAL_CRON_TOKEN/CRON_SECRET, comparación de tiempo
 * constante) y fail-closed por flag `AI_RUN_ORCHESTRATOR`. Procesa un LOTE acotado de
 * orquestaciones due (claim con lease, avance por fases con presupuesto de tiempo),
 * reanudando runs tras reinicio. NUNCA ejecuta herramientas con efecto: la única acción
 * externa posible es una llamada de modelo (A0/A1); los efectos A2+ paran en
 * `approval_required`. Devuelve un agregado SIN PII.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { cronAuthOk } from "@/lib/cron-auth";
import { orchestratorEnabled, autonomyKillSwitch } from "@/lib/ai/orchestrator/flags";
import { runBatch, type BatchResult } from "@/lib/ai/orchestrator/worker";
import { buildRunStep } from "@/lib/ai/orchestrator/scheduler";
import { getOrchestration, type Orchestration } from "@/lib/ai/orchestrator/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  // 1) Auth de cron (fail-closed: sin token configurado → 401).
  if (!cronAuthOk(req)) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  // 2) Kill-switch / flag (fail-closed): apagado → no hace nada.
  if (!orchestratorEnabled()) {
    return NextResponse.json({ ok: true, disabled: true, batch: null });
  }

  const owner = `cron-${Math.floor(Date.now() / 1000)}-${req.headers.get("x-request-id") ?? "tick"}`;
  const runStep = buildRunStep(prisma, process.env, { env: process.env });
  const killSwitch = () => autonomyKillSwitch();

  const reload = (o: Orchestration) => getOrchestration(prisma, o.workspaceId, o.id);

  let batch: BatchResult;
  try {
    batch = await runBatch(
      prisma,
      { runStep, killSwitch, now: () => new Date(), owner, leaseMs: 30_000, batchSize: 5, maxStepsPerRun: 12, maxWallMs: 25_000 },
      reload
    );
  } catch (e: any) {
    // No filtramos PII; solo un marcador de error del lote.
    console.error(`[ai-scheduler] fallo del lote: ${String(e?.name ?? "error")}`);
    return NextResponse.json({ ok: false, error: { code: "batch_error" } }, { status: 500 });
  }

  return NextResponse.json({ ok: true, batch });
}
