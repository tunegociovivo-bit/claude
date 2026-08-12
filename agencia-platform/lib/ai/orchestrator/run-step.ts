/**
 * runStep REAL (entrypoint del scheduler) — avanza UNA orquestación una fase, uniendo
 * controller + store + adapters + deadline + budgets + breaker + DAG + approvals.
 *
 * SEGURIDAD ESTRUCTURAL:
 *  - La ÚNICA acción externa que hace el scheduler es una llamada de MODELO (A0/A1).
 *    NUNCA ejecuta herramientas con efecto (mensajes/pagos/publicaciones/fiscal/…): si
 *    el diagnóstico es de política/efecto, `decideRecovery` → `approval_required` y el
 *    run se PARA. Los efectos A2+ requieren aprobación y un ejecutor aparte (no aquí).
 *  - "no fake success": `completed` solo se alcanza desde `verifying` con verificación
 *    explícita OK; cualquier fallo del proveedor va a `diagnosing`, jamás a completado.
 *  - Uso/coste REALES vienen de la respuesta del adaptador. PII redactada en `appendStep`
 *    y en el adaptador antes del egress. Deadline real por intento; breaker con sonda
 *    única por proveedor; presupuesto comprobado ANTES de gastar.
 */
import { isTerminal, type OrchState } from "./state-machine";
import { classifyFailure, type DiagnosisInput } from "./diagnosis";
import { decideRecovery } from "./controller";
import { budgetStatus, type BudgetLimits, DEFAULT_LIMITS, type BudgetUsage } from "./budget";
import { fingerprint } from "./fingerprint";
import { backoffMs } from "./backoff";
import { buildDecisionPacket, type EscalationCause } from "./decision-packet";
import { withDeadline, serializedProbe, settleBreaker, planSubtasks, chooseProvider, type Lock } from "./runtime";
import { MODEL_SLOTS, availableProviders, type ModelSlot, type ProviderId } from "./providers";
import type { AdapterRequest, AdapterResult, KeySources } from "./adapters";
import type { BreakerSnapshot } from "./circuit-breaker";
import { appendStep } from "./store";
import type { Orchestration } from "./store";

type PrismaLike = any;
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

export type RunStepDeps = {
  now: () => Date;
  env: NodeJS.ProcessEnv;
  keySources: KeySources;
  live: boolean; // true → llamada real; false → shadow simulado
  limits: BudgetLimits;
  attemptDeadlineMs: number;
  loadBreaker: (provider: string) => Promise<BreakerSnapshot>;
  persistBreaker: (provider: string, snap: BreakerSnapshot) => Promise<void>;
  lock: Lock;
  /** La llamada de modelo (envuelve adapter.complete). Inyectable para test sin red. */
  callModel: (slot: ModelSlot, req: AdapterRequest, opts: { signal: AbortSignal; live: boolean }) => Promise<AdapterResult>;
  /** Construye el request (system+mensajes) del run. La redacción PII la hace el adaptador. */
  buildRequest: (orch: Orchestration) => Promise<AdapterRequest>;
  /** Verificación explícita del resultado (dominio). Default: pasa (el adaptador ya validó
   *  no-vacío); un verificador real puede rechazar → vuelve a diagnosticar. */
  verify?: (orch: Orchestration) => Promise<boolean>;
  killSwitch?: () => boolean;
  rand?: () => number;
};

function normUsage(u: any): BudgetUsage {
  return { attempts: Number(u?.attempts) || 0, elapsedMs: Number(u?.elapsedMs) || 0, tokens: Number(u?.tokens) || 0, costUsd: Number(u?.costUsd) || 0 };
}

function packet(cause: EscalationCause, plan: any, diagnosis: string) {
  return buildDecisionPacket({ cause, diagnosis, attempts: plan?.attempts ?? [], triedStrategies: plan?.triedStrategies ?? [] });
}

/** Traduce un fallo real (deadline / HTTP / respuesta inválida / sin clave) a una pista
 *  de diagnóstico para el controller. NUNCA guarda el texto crudo salvo redactado. */
function failureToHint(failure: any): DiagnosisInput {
  const name = failure?.name ?? "";
  if (name === "DeadlineExceeded") return { hint: "transient", error: "timeout" };
  if (name === "ProviderHttpError") {
    if (failure.retryable) return { hint: "transient", error: `http ${failure.status}` };
    return { hint: "provider", error: `http ${failure.status}` };
  }
  if (name === "InvalidProviderResponse") return { hint: "provider", error: "respuesta inválida" };
  if (name === "MissingProviderKey" || failure?.unhealthy) return { hint: "provider", error: "proveedor no disponible" };
  return { hint: "tool", error: "fallo de ejecución" };
}

async function openProviders(deps: RunStepDeps): Promise<Set<string>> {
  const providers = [...new Set(MODEL_SLOTS.map((s) => s.provider))];
  const open = new Set<string>();
  for (const p of providers) {
    const b = await deps.loadBreaker(p);
    if (b.state === "open") open.add(p);
  }
  return open;
}

/** Fábrica del runStep. Devuelve `(orch) => {to, patch}` que aplica `stepOrchestration`. */
export function makeRunStep(prisma: PrismaLike, deps: RunStepDeps) {
  return async function runStep(orch: Orchestration): Promise<{ to: OrchState; patch?: any }> {
    const plan = (orch.plan as any) ?? {};
    const limits: BudgetLimits = (orch.limits as any) ?? deps.limits ?? DEFAULT_LIMITS;

    switch (orch.state) {
      case "queued":
        return { to: "planning", patch: { plan: { need: plan.need ?? { capabilities: [] }, parentAutonomy: plan.parentAutonomy ?? "A1", ...plan }, limits } };

      case "planning":
        return { to: "executing", patch: { strategy: "intento inicial" } };

      case "waiting_backoff":
        return { to: "executing", patch: {} };

      case "decomposing": {
        const subtasks = plan.subtasks ?? [];
        if (!subtasks.length) return { to: "executing", patch: {} };
        const v = planSubtasks(subtasks, plan.parentAutonomy ?? "A1");
        if (!v.ok) return { to: "materially_blocked", patch: { decision: packet("no_distinct_strategy", plan, `Descomposición insegura: ${v.error}`) } };
        return { to: "executing", patch: { plan: { ...plan, order: v.order } } };
      }

      case "verifying": {
        const ok = deps.verify ? await deps.verify(orch) : true;
        if (ok) return { to: "completed", patch: {} };
        return { to: "diagnosing", patch: { plan: { ...plan, diag: { verificationFailed: true } } } };
      }

      case "executing": {
        const usage = normUsage(orch.usage);
        // Presupuesto ANTES de gastar.
        if (budgetStatus(usage, limits).exhausted) {
          return { to: "budget_exhausted", patch: { decision: packet("budget_exhausted", plan, "Presupuesto agotado antes del intento") } };
        }
        const tried: ProviderId[] = plan.tried ?? [];
        const open = await openProviders(deps);
        const slot = chooseProvider(plan.need ?? { capabilities: [] }, deps.env, { exclude: tried, breakerOpen: (p) => open.has(p) });
        if (!slot) {
          return { to: "materially_blocked", patch: { decision: packet("no_distinct_strategy", plan, "Sin proveedor sano disponible") } };
        }
        // Sonda única del breaker bajo lock por proveedor.
        const probe = await serializedProbe(deps.lock, slot.provider, () => deps.loadBreaker(slot.provider), (s) => deps.persistBreaker(slot.provider, s), deps.now().getTime());
        if (!probe.pass) {
          const wait = backoffMs(usage.attempts, undefined, deps.rand ?? Math.random);
          return { to: "waiting_backoff", patch: { nextRunAt: new Date(deps.now().getTime() + wait), strategy: `esperar breaker ${slot.provider}` } };
        }
        // Intento REAL con deadline.
        const req = await deps.buildRequest(orch);
        const t0 = deps.now().getTime();
        let result: AdapterResult | null = null;
        let failure: any = null;
        try {
          result = await withDeadline(deps.attemptDeadlineMs, (signal) => deps.callModel(slot, req, { signal, live: deps.live }), { phase: "modelo" });
        } catch (e) {
          failure = e;
        }
        const elapsed = Math.max(0, deps.now().getTime() - t0);
        await settleBreaker(() => deps.loadBreaker(slot.provider), (s) => deps.persistBreaker(slot.provider, s), !failure, deps.now().getTime());

        const usage2: BudgetUsage = {
          attempts: usage.attempts + 1,
          elapsedMs: usage.elapsedMs + elapsed,
          tokens: usage.tokens + (result ? result.usage.inputTokens + result.usage.outputTokens : 0),
          costUsd: round4(usage.costUsd + (result ? result.usage.costUsd : 0))
        };
        await appendStep(prisma, {
          workspaceId: orch.workspaceId,
          orchestrationId: orch.id,
          phase: "executing",
          provider: slot.provider,
          model: slot.model,
          ok: !failure,
          costUsd: result?.usage.costUsd ?? null,
          tokensIn: result?.usage.inputTokens ?? null,
          tokensOut: result?.usage.outputTokens ?? null,
          diagnosis: failure ? classifyFailure(failureToHint(failure)).class : null
        });

        if (!failure && result) {
          return { to: "verifying", patch: { usage: usage2, provider: slot.provider, plan: { ...plan, lastProvider: slot.provider } } };
        }
        return { to: "diagnosing", patch: { usage: usage2, plan: { ...plan, diag: failureToHint(failure), tried: [...tried, slot.provider], lastProvider: slot.provider } } };
      }

      case "diagnosing": {
        const usage = normUsage(orch.usage);
        const diagInput: DiagnosisInput = plan.diag ?? {};
        const diag = classifyFailure(diagInput);
        const fpHist: string[] = Array.isArray(orch.fingerprints) ? (orch.fingerprints as string[]) : [];
        const fp = fingerprint({ phase: "executing", strategy: plan.lastStrategyKind ?? "", diagnosis: diag.class, target: plan.lastProvider, model: null, error: diagInput.error });
        const decision = decideRecovery({
          diagnosis: diag,
          usage,
          limits,
          fingerprintHistory: fpHist,
          currentFingerprint: fp,
          strategyCtx: { tried: plan.triedStrategies ?? [], canDecompose: (plan.subtasks?.length ?? 0) > 0, availableProviders: availableProviders(deps.env) },
          attempts: plan.attempts ?? [],
          rand: deps.rand ?? Math.random,
          killSwitch: deps.killSwitch?.()
        });
        const fingerprints = [...fpHist, fp];
        if (isTerminal(decision.to) || decision.to === "approval_required") {
          return { to: decision.to, patch: { fingerprints, decision: decision.packet ?? null } };
        }
        const patch: any = {
          fingerprints,
          strategy: decision.strategy?.label ?? null,
          plan: { ...plan, lastStrategyKind: decision.strategy?.kind ?? plan.lastStrategyKind, triedStrategies: [...(plan.triedStrategies ?? []), decision.strategy].filter(Boolean) }
        };
        if (decision.to === "waiting_backoff") patch.nextRunAt = new Date(deps.now().getTime() + (decision.backoffMs ?? 0));
        return { to: decision.to, patch };
      }

      default:
        // Estado terminal o desconocido → no avanzar (defensivo).
        return { to: orch.state as OrchState, patch: {} };
    }
  };
}
