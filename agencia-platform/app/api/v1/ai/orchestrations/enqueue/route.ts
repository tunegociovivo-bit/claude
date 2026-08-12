/**
 * POST /api/v1/ai/orchestrations/enqueue — ENQUEUER LIVE productivo (A0/A1).
 *
 * Crea una orquestación en `mode:"live"`, `state:"queued"`, `nextRunAt=now`, para que el
 * scheduler (`/tick`) la procese en el próximo lote. Es la pieza que faltaba para llevar
 * el motor de autonomía de Sonia a producción de forma SEGURA y ACOTADA.
 *
 * INVARIANTES DE SEGURIDAD (fail-closed):
 *  - Admin autenticado + tenant-scoped: el `workspaceId` lo fija SIEMPRE el servidor
 *    (`api.workspaceId`); un `workspaceId` en el body se IGNORA (nunca arbitrario).
 *  - Solo A0/A1 (observar/recomendar) y tareas INTERNAS sin efecto externo. A2/A3/A4 →
 *    422 `requires_approval`: los efectos requieren aprobación previa y un ejecutor aparte;
 *    el scheduler NUNCA ejecuta herramientas con efecto (solo llamada de modelo).
 *  - `taskType` de una allowlist interna + `verification` validada ESTRICTAMENTE: el run
 *    solo se acepta si su resultado será objetivamente verificable (nunca por longitud).
 *  - Idempotente por `taskId` (@@unique([workspaceId, taskId])): reintentos no duplican.
 *  - Límites acotados (intentos/tiempo/tokens/coste) por el techo del canary; el cliente
 *    solo puede PEDIR menos, jamás más.
 *  - Rate-limit admin (bucket) + tope de concurrencia por workspace (runs vivos).
 *  - Auditoría: paso append-only `phase:"enqueued"` + log de servidor.
 *  - Kill-switch/flag: `AI_RUN_ORCHESTRATOR` off → 404 (endpoint inalcanzable).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { orchestratorEnabled, orchestratorMode, multiModelEnabled } from "@/lib/ai/orchestrator/flags";
import { validateVerificationSpec, verifierTypeFor } from "@/lib/ai/orchestrator/verifiers";
import { enqueueLiveOrchestration, countActiveOrchestrations, appendStep } from "@/lib/ai/orchestrator/store";
import { canaryLimits } from "@/lib/ai/orchestrator/scheduler";
import { sanitizeLimits, type BudgetLimits } from "@/lib/ai/orchestrator/budget";
import { ORCH_STATES, isTerminal } from "@/lib/ai/orchestrator/state-machine";
import { redactPii } from "@/lib/ai/orchestrator/pii-redact";

export const dynamic = "force-dynamic";

// Solo estos niveles pueden encolarse LIVE: observar/recomendar, sin efecto externo.
const LIVE_AUTONOMY = new Set(["A0", "A1"]);
// Techos defensivos de entrada (el objetivo es un prompt interno, no una carga).
const MAX_OBJECTIVE = 8_000;
const MAX_SYSTEM = 4_000;
const MAX_TASKID = 200;
const MAX_CAPABILITIES = 12;
const MAX_CAPABILITY_LEN = 64;
// Tope de orquestaciones VIVAS por workspace (evita inundar el scheduler). Configurable.
const activeCap = (): number => {
  const n = Number(process.env.AI_ENQUEUE_ACTIVE_CAP);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 25;
};
// Estados NO terminales = un run "vivo" que ocupa cupo de concurrencia.
const ACTIVE_STATES = ORCH_STATES.filter((s) => !isTerminal(s));

const bad = (code: string, message: string, status = 400) => NextResponse.json({ error: { code, message } }, { status });

/** Combina el techo del canary con lo pedido por el cliente: cada límite es el MENOR de
 *  (pedido válido, techo). El cliente nunca puede subir por encima del techo del canary. */
function clampLimits(env: NodeJS.ProcessEnv, requested: unknown): BudgetLimits {
  const ceiling = canaryLimits(env);
  const req = sanitizeLimits((requested ?? {}) as Partial<BudgetLimits>);
  const asked = requested && typeof requested === "object" ? (requested as Record<string, unknown>) : {};
  // Si el cliente NO aportó un campo, usa el techo; si lo aportó, satura al techo.
  const pick = (key: keyof BudgetLimits) => (asked[key] == null ? ceiling[key] : Math.min(req[key], ceiling[key]));
  return {
    maxAttempts: pick("maxAttempts"),
    maxWallMs: pick("maxWallMs"),
    maxTokens: pick("maxTokens"),
    maxCostUsd: pick("maxCostUsd")
  };
}

export const POST = withApi({ scope: "*", rate: "admin", admin: true }, async (req, { api }) => {
  // 1) Kill-switch / flag (fail-closed): endpoint inalcanzable si el orquestador está off.
  if (!orchestratorEnabled()) {
    return NextResponse.json({ error: { code: "disabled", message: "Orquestador desactivado" } }, { status: 404 });
  }
  // 1b) LIVE de verdad: solo se encolan runs `mode:"live"` cuando el motor los ejecutará en
  //     live (AI_RUN_ORCHESTRATOR=live + AI_MULTIMODEL=on). Si está en SHADOW, encolar "live"
  //     sería engañoso (el /tick los correría simulados) → 409 honesto (no un mode:live falso).
  if (!(orchestratorMode() === "live" && multiModelEnabled())) {
    return NextResponse.json(
      { error: { code: "engine_shadow", message: "El motor no está en modo LIVE (requiere AI_RUN_ORCHESTRATOR=live y AI_MULTIMODEL=on). No se encolan runs live en shadow." } },
      { status: 409 }
    );
  }
  // 2) Rol admin (además del gate central) — defensa en profundidad.
  await requireAdmin(api);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return bad("bad_request", "Cuerpo JSON requerido");

  // 3) taskId (idempotencia) — obligatorio, acotado.
  const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
  if (!taskId) return bad("bad_request", "taskId es obligatorio");
  if (taskId.length > MAX_TASKID) return bad("bad_request", `taskId excede ${MAX_TASKID} caracteres`);

  // 4) Autonomía: SOLO A0/A1. A2/A3/A4 → 422 requires_approval (fail-closed).
  const autonomy = typeof body.autonomy === "string" ? body.autonomy.trim().toUpperCase() : "";
  if (!autonomy) return bad("bad_request", "autonomy es obligatorio (A0 o A1)");
  if (!LIVE_AUTONOMY.has(autonomy)) {
    return NextResponse.json(
      { error: { code: "requires_approval", message: `El nivel ${autonomy} tiene efecto externo: requiere aprobación previa y no puede encolarse LIVE. Solo A0/A1.` } },
      { status: 422 }
    );
  }

  // 5) objective (prompt interno) — obligatorio, acotado.
  const objective = typeof body.objective === "string" ? body.objective.trim() : "";
  if (!objective) return bad("bad_request", "objective es obligatorio");
  if (objective.length > MAX_OBJECTIVE) return bad("bad_request", `objective excede ${MAX_OBJECTIVE} caracteres`);

  // 6) system (opcional) acotado.
  let system: string | undefined;
  if (body.system != null) {
    if (typeof body.system !== "string") return bad("bad_request", "system debe ser string");
    const trimmed = body.system.trim();
    if (trimmed.length > MAX_SYSTEM) return bad("bad_request", `system excede ${MAX_SYSTEM} caracteres`);
    system = trimmed || undefined;
  }

  // 7) capabilities (opcional) — lista corta de strings.
  let capabilities: string[] = [];
  if (body.capabilities != null) {
    if (!Array.isArray(body.capabilities)) return bad("bad_request", "capabilities debe ser un array de strings");
    if (body.capabilities.length > MAX_CAPABILITIES) return bad("bad_request", `capabilities excede ${MAX_CAPABILITIES} elementos`);
    for (const c of body.capabilities) {
      if (typeof c !== "string" || !c.trim() || c.length > MAX_CAPABILITY_LEN) return bad("bad_request", "cada capability debe ser una string no vacía y acotada");
      capabilities.push(c.trim());
    }
  }

  // 8) taskType + verification — validación ESTRICTA (debe ser objetivamente verificable).
  const taskType = typeof body.taskType === "string" ? body.taskType.trim() : "";
  if (!taskType) return bad("bad_request", "taskType es obligatorio");
  const v = validateVerificationSpec(taskType, body.verification);
  if (!v.ok) return bad("invalid_verification", v.error, 422);
  // La `verification` se PERSISTE en el plan → no debe contener PII/secretos (usa
  // identificadores no sensibles). Rechaza cualquier string del spec que dispare el redactor
  // (email/clave/teléfono/…) para no guardar PII en reposo (invariante de minimización).
  const specStrings = [
    ...(v.spec.mustCoverKeyPoints ?? []),
    ...(v.spec.requiredSections ?? []),
    ...(v.spec.requiredFields ?? []),
    ...(v.spec.mustReference ?? []),
    ...(v.spec.mustNotContain ?? [])
  ];
  if (specStrings.some((s) => redactPii(s).text !== s)) {
    return bad("invalid_verification", "verification no debe contener PII/secretos (usa identificadores no sensibles: ticket, nombre de sección, campo…)", 422);
  }

  // 9) Límites acotados por el techo del canary (el cliente solo puede pedir MENOS).
  const limits = clampLimits(process.env, body.limits);

  // 10) Tope de concurrencia por workspace (rate-limit a nivel de datos). El tope solo
  //     frena NUEVOS runs: un reintento idempotente de un `taskId` YA existente nunca se
  //     rechaza (preserva la idempotencia aunque el workspace esté al tope).
  const cap = activeCap();
  const active = await countActiveOrchestrations(prisma, api.workspaceId, ACTIVE_STATES as unknown as string[], "live");
  if (active >= cap) {
    const existing = await prisma.aiOrchestration.findFirst({ where: { workspaceId: api.workspaceId, taskId } });
    if (!existing) {
      return NextResponse.json(
        { error: { code: "too_many_active", message: `Hay ${active} orquestaciones vivas (tope ${cap}). Espera a que terminen antes de encolar más.` } },
        { status: 429 }
      );
    }
    // existe → cae al enqueue idempotente (devuelve la existente con created:false).
  }

  // 11) Plan saneado. El `objective`/`system` los vuelve a redactar el adaptador antes de
  //     cualquier egress; aquí redactamos PII de entrada como minimización en la frontera.
  const plan = {
    taskType,
    autonomy,
    objective: redactPii(objective).text,
    ...(system ? { system: redactPii(system).text } : {}),
    need: { capabilities },
    verification: v.spec,
    parentAutonomy: autonomy,
    source: "enqueue" as const
  };

  // 12) Crear/recuperar IDEMPOTENTE (mode:live, queued, nextRunAt=now). workspaceId del server.
  const now = new Date();
  const { orchestration, created } = await enqueueLiveOrchestration(prisma, {
    workspaceId: api.workspaceId,
    taskId,
    createdById: api.userId ?? null,
    plan,
    limits,
    now
  });

  // 13) Auditoría: paso append-only + log de servidor (sin PII: solo hechos/tipo).
  if (created) {
    try {
      await appendStep(prisma, {
        workspaceId: api.workspaceId,
        orchestrationId: orchestration.id,
        phase: "enqueued",
        strategy: "live",
        evidence: { taskType, verifierType: v.verifierType, autonomy, source: "enqueue" }
      });
    } catch {
      // La auditoría no debe tumbar el encolado ya persistido; el step es best-effort aquí.
    }
    // Log sin PII: solo el verificador derivado (no el `taskType` crudo, que es texto libre).
    console.info(`[ai-enqueue] live queued ws=${api.workspaceId} orch=${orchestration.id} verifier=${v.verifierType} autonomy=${autonomy} by=${api.userId ?? "?"}`);
  }

  // Respuesta HONESTA: si ya existía (idempotencia), refleja lo REALMENTE encolado (del row
  // almacenado), no los valores del request actual (que no se aplicaron).
  const storedPlan = (orchestration.plan as any) ?? {};
  return NextResponse.json(
    {
      id: orchestration.id,
      taskId,
      created, // false → ya existía (idempotencia)
      mode: orchestration.mode,
      state: orchestration.state,
      nextRunAt: orchestration.nextRunAt,
      autonomy: created ? autonomy : storedPlan.autonomy ?? null,
      taskType: created ? taskType : storedPlan.taskType ?? null,
      verifierType: created ? v.verifierType : verifierTypeFor(storedPlan.taskType),
      limits: created ? limits : orchestration.limits
    },
    { status: created ? 201 : 200 }
  );
});
