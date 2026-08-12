/**
 * POST /api/v1/ai/orchestrations/simulate  (Slice 2c.3 — simulador SHADOW)
 *
 * Ejecuta el bucle de recuperación de Sonia en SIMULACIÓN pura sobre un ESCENARIO
 * de intentos aportado (qué pasaría en cada ejecución) y PERSISTE la traza como una
 * orquestación + pasos append-only, para poder demostrarlo/inspeccionarlo en el
 * panel. NO ejecuta NADA real: ni red, ni proveedores, ni acciones externas. Sirve
 * para validar diagnóstico→reformulación→fallback→backoff→DAG→verificación→escalado
 * sin tocar ningún sistema. Scoped por workspace. Solo ADMIN. Kill-switch:
 * AI_RUN_ORCHESTRATOR off → 404.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { orchestratorEnabled } from "@/lib/ai/orchestrator/flags";
import { runAndPersistSimulation } from "@/lib/ai/orchestrator/driver";
import { sanitizeLimits } from "@/lib/ai/orchestrator/budget";
import { redactPii } from "@/lib/ai/orchestrator/pii-redact";
import type { AttemptOutcome, SimConfig } from "@/lib/ai/orchestrator/simulate";

export const dynamic = "force-dynamic";

// Límite defensivo: un escenario es una demostración acotada, no una carga real.
// Alineado con el `maxLoops` por defecto del simulador (20) para no truncar en
// silencio los intentos 21+ del escenario.
const MAX_SCENARIO = 20;

/** Redacta PII de los campos de texto de un diagnóstico aportado por el cliente
 *  ANTES de que entre al simulador (minimización PII en la frontera). No rompe la
 *  clasificación: los patrones de clase (credencial/timeout/…) no son PII. */
function safeDiagnosis(d: any): Record<string, unknown> | undefined {
  if (!d || typeof d !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    out[k] = typeof v === "string" ? redactPii(v).text : v;
  }
  return out;
}

export const POST = withApi({ scope: "*", rate: "admin", admin: true }, async (req, { api }) => {
  if (!orchestratorEnabled()) {
    return NextResponse.json({ error: { code: "disabled", message: "Orquestador desactivado" } }, { status: 404 });
  }
  await requireAdmin(api);

  const body = await req.json().catch(() => null);
  const taskId = typeof body?.taskId === "string" ? body.taskId.trim() : "";
  const scenario = Array.isArray(body?.scenario) ? (body.scenario as AttemptOutcome[]) : null;
  if (!taskId || !scenario || scenario.length === 0) {
    return NextResponse.json({ error: { code: "bad_request", message: "taskId y scenario[] son obligatorios" } }, { status: 400 });
  }
  if (scenario.length > MAX_SCENARIO) {
    return NextResponse.json({ error: { code: "too_large", message: `scenario máximo ${MAX_SCENARIO} intentos` } }, { status: 400 });
  }
  // Normaliza los outcomes a un shape inerte (nada aquí ejecuta): solo datos.
  const safeScenario: AttemptOutcome[] = scenario.map((a: any) => ({
    ok: !!a?.ok,
    verifyOk: typeof a?.verifyOk === "boolean" ? a.verifyOk : undefined,
    diagnosis: safeDiagnosis(a?.diagnosis) as AttemptOutcome["diagnosis"],
    provider: typeof a?.provider === "string" ? a.provider : undefined,
    tokens: Number.isFinite(a?.tokens) ? Number(a.tokens) : undefined,
    costUsd: Number.isFinite(a?.costUsd) ? Number(a.costUsd) : undefined,
    elapsedMs: Number.isFinite(a?.elapsedMs) ? Number(a.elapsedMs) : undefined
  }));

  // Config saneada: límites acotados por `sanitizeLimits` (evita NaN/negativos que
  // romperían el presupuesto) y loopThreshold a entero positivo.
  const rawLoop = Number(body?.config?.loopThreshold);
  const config: SimConfig = {
    limits: sanitizeLimits(body?.config?.limits),
    loopThreshold: Number.isFinite(rawLoop) && rawLoop >= 1 ? Math.floor(rawLoop) : undefined
  };

  const { orchestrationId, result, persistedSteps } = await runAndPersistSimulation(prisma, {
    workspaceId: api.workspaceId,
    taskId,
    createdById: api.userId ?? null,
    scenario: safeScenario,
    config
  });

  return NextResponse.json({
    id: orchestrationId,
    mode: "shadow",
    executed: false, // invariante: la simulación no ejecuta nada real
    finalState: result.finalState,
    usage: result.usage,
    decision: result.decision ?? null,
    steps: persistedSteps // filas realmente persistidas (no el conteo simulado)
  });
});
