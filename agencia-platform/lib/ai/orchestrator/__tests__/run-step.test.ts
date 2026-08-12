/**
 * runStep REAL — motor de fases con deps mockeadas (sin red). Cubre: plan→execute→
 * verify→diagnose→recover, éxito con uso/coste real, 429/timeout, budget, sin proveedor,
 * breaker abierto, failover, DAG (válido/elevación), aprobación (A2+), kill-switch y
 * "no fake success". Ninguna herramienta de efecto se invoca jamás.
 */
import { describe, it, expect, vi } from "vitest";
import { makeRunStep, type RunStepDeps } from "../run-step";
import { canTransition } from "../state-machine";
import type { DurableBreaker } from "../breaker-store";
import { DEFAULT_LIMITS } from "../budget";
import { ProviderHttpError, InvalidProviderResponse, MissingProviderKey } from "../live-adapters";
import { DeadlineExceeded } from "../runtime";

function mkPrisma() {
  const steps: any[] = [];
  return {
    _steps: steps,
    aiRunStep: {
      findFirst: vi.fn(async () => (steps.length ? { seq: steps[steps.length - 1].seq } : null)),
      create: vi.fn(async ({ data }: any) => {
        steps.push(data);
        return { ...data };
      })
    }
  };
}

const okResult = (over: any = {}) => ({ slotId: "s", provider: "anthropic", model: "m", mode: "shadow", executed: false, text: "ok", usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 }, piiRedactions: 0, ...over });

/** Breaker de test: pasa siempre salvo que `blocked` contenga "ws:provider". */
function fakeBreaker(blocked: Set<string> = new Set()): DurableBreaker {
  return {
    peekBlocked: async (ws, p) => blocked.has(`${ws}:${p}`),
    tryPass: async (ws, p) => ({ pass: !blocked.has(`${ws}:${p}`), probe: false }),
    record: async () => {}
  };
}

function mkDeps(over: Partial<RunStepDeps> = {}): RunStepDeps {
  const t = 1_000_000;
  return {
    now: () => new Date(t),
    env: { ANTHROPIC_API_KEY: "x", OPENAI_API_KEY: "y" } as any,
    keySources: { env: { ANTHROPIC_API_KEY: "x", OPENAI_API_KEY: "y" } as any },
    live: false,
    limits: DEFAULT_LIMITS,
    attemptDeadlineMs: 5000,
    breaker: fakeBreaker(),
    callModel: async () => okResult() as any,
    buildRequest: async () => ({ messages: [{ role: "user", content: "hola" }] }),
    rand: () => 0.5,
    ...over
  };
}

const orch = (over: any = {}): any => ({ id: "o1", workspaceId: "w1", state: "queued", version: 0, usage: { attempts: 0, elapsedMs: 0, tokens: 0, costUsd: 0 }, fingerprints: [], plan: {}, limits: DEFAULT_LIMITS, ...over });

describe("runStep — fases", () => {
  it("queued → planning; planning → executing; waiting_backoff → executing", async () => {
    const rs = makeRunStep(mkPrisma() as any, mkDeps());
    expect((await rs(orch({ state: "queued" }))).to).toBe("planning");
    expect((await rs(orch({ state: "planning" }))).to).toBe("executing");
    expect((await rs(orch({ state: "waiting_backoff" }))).to).toBe("executing");
  });

  it("executing éxito → verifying con uso/coste REALES acumulados", async () => {
    const prisma = mkPrisma();
    const rs = makeRunStep(prisma as any, mkDeps({ callModel: async () => okResult({ usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.02 } }) as any }));
    const r = await rs(orch({ state: "executing", usage: { attempts: 1, elapsedMs: 1000, tokens: 10, costUsd: 0.005 } }));
    expect(r.to).toBe("verifying");
    expect(r.patch.usage.attempts).toBe(2);
    expect(r.patch.usage.tokens).toBe(160); // 10 + 150
    expect(r.patch.usage.costUsd).toBeCloseTo(0.025, 4);
    // paso persistido con ok=true
    expect(prisma._steps[0].ok).toBe(true);
    expect(prisma._steps[0].provider).toBeTruthy();
  });

  it("verifying ok → completed; verify falla → diagnosing (no fake success)", async () => {
    expect((await makeRunStep(mkPrisma() as any, mkDeps())(orch({ state: "verifying" }))).to).toBe("completed");
    const r = await makeRunStep(mkPrisma() as any, mkDeps({ verify: async () => ({ ok: false }) }))(orch({ state: "verifying" }));
    expect(r.to).toBe("diagnosing");
  });

  it("executing fallo 429 (retryable) → diagnosing con pista transitoria (nunca completed)", async () => {
    const rs = makeRunStep(mkPrisma() as any, mkDeps({ callModel: async () => { throw new ProviderHttpError("anthropic", 429, 3000, true); } }));
    const r = await rs(orch({ state: "executing" }));
    expect(r.to).toBe("diagnosing");
    expect(r.patch.plan.diag.hint).toBe("transient");
  });

  it("executing timeout (deadline) → diagnosing transitorio", async () => {
    const rs = makeRunStep(mkPrisma() as any, mkDeps({ callModel: async () => { throw new DeadlineExceeded("modelo"); } }));
    expect((await rs(orch({ state: "executing" }))).to).toBe("diagnosing");
  });

  it("executing sin proveedor sano (sin claves) → materially_blocked", async () => {
    const rs = makeRunStep(mkPrisma() as any, mkDeps({ env: {} as any }));
    const r = await rs(orch({ state: "executing" }));
    expect(r.to).toBe("materially_blocked");
    expect(r.patch.decision.cause).toBe("no_distinct_strategy");
  });

  it("executing presupuesto agotado → budget_exhausted (antes de gastar)", async () => {
    const called = vi.fn(async () => okResult() as any);
    const rs = makeRunStep(mkPrisma() as any, mkDeps({ callModel: called, limits: { ...DEFAULT_LIMITS, maxAttempts: 1 } }));
    const r = await rs(orch({ state: "executing", usage: { attempts: 5, elapsedMs: 0, tokens: 0, costUsd: 0 }, limits: { ...DEFAULT_LIMITS, maxAttempts: 1 } }));
    expect(r.to).toBe("budget_exhausted");
    expect(called).not.toHaveBeenCalled(); // no gasta si ya está agotado
  });

  it("executing con TODOS los breakers bloqueados → materially_blocked (excluye bloqueados)", async () => {
    const rs = makeRunStep(mkPrisma() as any, mkDeps({ breaker: fakeBreaker(new Set(["w1:anthropic", "w1:openai", "w1:gemini", "w1:perplexity"])) }));
    const r = await rs(orch({ state: "executing" }));
    expect(r.to).toBe("materially_blocked");
    expect(r.patch.decision.cause).toBe("no_distinct_strategy");
  });

  it("executing con la sonda del breaker rechazada (tryPass=false) → waiting_backoff (no martillea)", async () => {
    const breaker: DurableBreaker = { peekBlocked: async () => false, tryPass: async () => ({ pass: false, probe: false }), record: async () => {} };
    const rs = makeRunStep(mkPrisma() as any, mkDeps({ breaker }));
    const r = await rs(orch({ state: "executing" }));
    expect(r.to).toBe("waiting_backoff");
    expect(r.patch.nextRunAt instanceof Date).toBe(true);
  });

  it("failover: el proveedor ya probado se excluye → usa otro", async () => {
    let usedProvider = "";
    const rs = makeRunStep(mkPrisma() as any, mkDeps({ callModel: async (slot) => { usedProvider = slot.provider; return okResult() as any; } }));
    // anthropic ya probado → debe elegir openai
    await rs(orch({ state: "executing", plan: { tried: ["anthropic"], need: { capabilities: [] } } }));
    expect(usedProvider).toBe("openai");
  });

  it("diagnosing: política → approval_required (A2+ NUNCA se ejecuta solo)", async () => {
    const rs = makeRunStep(mkPrisma() as any, mkDeps());
    const r = await rs(orch({ state: "diagnosing", plan: { diag: { policyBlocked: true } } }));
    expect(r.to).toBe("approval_required");
    expect(r.patch.decision.cause).toBe("policy_approval");
  });

  it("diagnosing: material (falta credencial) → materially_blocked", async () => {
    const rs = makeRunStep(mkPrisma() as any, mkDeps());
    const r = await rs(orch({ state: "diagnosing", plan: { diag: { error: "falta credencial no configurada" } } }));
    expect(r.to).toBe("materially_blocked");
    expect(r.patch.decision.cause).toBe("missing_data");
  });

  it("diagnosing: transitorio → waiting_backoff con nextRunAt futuro", async () => {
    const rs = makeRunStep(mkPrisma() as any, mkDeps());
    const r = await rs(orch({ state: "diagnosing", plan: { diag: { hint: "transient" }, need: { capabilities: [] } } }));
    expect(r.to).toBe("waiting_backoff");
    expect(r.patch.nextRunAt instanceof Date).toBe(true);
  });

  it("diagnosing con kill-switch → cancelled por encima de todo", async () => {
    const rs = makeRunStep(mkPrisma() as any, mkDeps({ killSwitch: () => true }));
    const r = await rs(orch({ state: "diagnosing", plan: { diag: { hint: "transient" } } }));
    expect(r.to).toBe("cancelled");
  });

  it("decomposing: DAG válido → executing; con elevación de autonomía → materially_blocked", async () => {
    const rs = makeRunStep(mkPrisma() as any, mkDeps());
    const good = await rs(orch({ state: "decomposing", plan: { subtasks: [{ id: "a", title: "a", deps: [] }], parentAutonomy: "A2" } }));
    expect(good.to).toBe("executing");
    const bad = await rs(orch({ state: "decomposing", plan: { subtasks: [{ id: "a", title: "a", deps: [], maxAutonomy: "A4" }], parentAutonomy: "A2" } }));
    expect(bad.to).toBe("materially_blocked");
  });

  it("no fake success: un fallo jamás produce 'completed'", async () => {
    const rs = makeRunStep(mkPrisma() as any, mkDeps({ callModel: async () => { throw new InvalidProviderResponse("openai", "vacío"); } }));
    const r = await rs(orch({ state: "executing" }));
    expect(r.to).not.toBe("completed");
    expect(r.to).toBe("diagnosing");
  });

  it("sin clave → el adaptador degrada; runStep lo trata como fallo de proveedor (no finge)", async () => {
    const rs = makeRunStep(mkPrisma() as any, mkDeps({ callModel: async () => { const e: any = new MissingProviderKey("openai"); throw e; } }));
    const r = await rs(orch({ state: "executing" }));
    expect(r.to).toBe("diagnosing");
    expect(r.patch.plan.diag.hint).toBe("provider");
  });

  it("APRENDIZAJE: éxito verificado → recordOutcome(ok, verified) con firma/causa/estrategia", async () => {
    const rec: any[] = [];
    const learning = { recordOutcome: async (a: any) => void rec.push(a), recommend: async () => [] };
    const rs = makeRunStep(mkPrisma() as any, mkDeps({ live: true, learning, verify: async () => ({ ok: true, evidence: { check: "objetivo" } }) }));
    const r = await rs(orch({ state: "verifying", plan: { signature: "sig1", addressingCause: "provider:x", attemptStrategyKind: "switch_provider", attemptProvider: "anthropic" } }));
    expect(r.to).toBe("completed");
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({ verified: true, ok: true, taskSignature: "sig1", rootCause: "provider:x", strategyKind: "switch_provider", provider: "anthropic" });
  });

  it("APRENDIZAJE: en SHADOW (live=false) NO se aprende (resultado simulado, no real)", async () => {
    const rec: any[] = [];
    const learning = { recordOutcome: async (a: any) => void rec.push(a), recommend: async () => [] };
    const rs = makeRunStep(mkPrisma() as any, mkDeps({ live: false, learning, verify: async () => ({ ok: true }) }));
    await rs(orch({ state: "verifying", plan: { signature: "sig1", addressingCause: "initial", attemptProvider: "anthropic" } }));
    expect(rec).toHaveLength(0); // shadow no contamina la memoria
  });

  it("APRENDIZAJE: fallo NO transitorio → recordOutcome(ok=false) para evitar esa estrategia", async () => {
    const rec: any[] = [];
    const learning = { recordOutcome: async (a: any) => void rec.push(a), recommend: async () => [] };
    const rs = makeRunStep(mkPrisma() as any, mkDeps({ live: true, learning }));
    await rs(orch({ state: "diagnosing", plan: { signature: "sig1", addressingCause: "initial", attemptStrategyKind: "retry_same", attemptProvider: "openai", diag: { hint: "provider" } } }));
    expect(rec.some((a) => a.verified === true && a.ok === false && a.provider === "openai")).toBe(true);
  });

  it("APRENDIZAJE: un fallo TRANSITORIO (429) NO se aprende (es infra, no la estrategia)", async () => {
    const rec: any[] = [];
    const learning = { recordOutcome: async (a: any) => void rec.push(a), recommend: async () => [] };
    const rs = makeRunStep(mkPrisma() as any, mkDeps({ live: true, learning }));
    await rs(orch({ state: "diagnosing", plan: { signature: "sig1", addressingCause: "initial", attemptProvider: "openai", diag: { hint: "transient" } } }));
    expect(rec).toHaveLength(0);
  });

  it("REUTILIZACIÓN: recommend prioriza el proveedor aprendido como exitoso", async () => {
    let used = "";
    const learning = { recordOutcome: async () => {}, recommend: async () => [{ strategyKind: "switch_provider", provider: "openai", model: "", score: 0.9, successCount: 3, failureCount: 0 }] };
    // sin aprendizaje, el orden por coste elegiría anthropic; con prefer=openai debe usar openai
    const rs = makeRunStep(mkPrisma() as any, mkDeps({ learning, callModel: async (slot) => { used = slot.provider; return okResult() as any; } }));
    await rs(orch({ state: "executing", plan: { need: { capabilities: [] }, diag: { hint: "provider" } } }));
    expect(used).toBe("openai"); // reutiliza lo aprendido
  });

  it("CONTRATO (HIGH #1): toda salida de runStep es una transición VÁLIDA desde su estado", async () => {
    // Escenarios que fuerzan cada rama, incl. executing→{waiting_backoff,materially_blocked,budget_exhausted}.
    const cases: Array<{ from: any; deps?: Partial<RunStepDeps>; over?: any }> = [
      { from: "queued" },
      { from: "planning" },
      { from: "waiting_backoff" },
      { from: "verifying" },
      { from: "verifying", deps: { verify: async () => ({ ok: false }) } },
      { from: "executing" }, // éxito → verifying
      { from: "executing", deps: { callModel: async () => { throw new ProviderHttpError("anthropic", 429, 1, true); } } }, // → diagnosing
      { from: "executing", deps: { env: {} as any } }, // sin proveedor → materially_blocked
      { from: "executing", over: { usage: { attempts: 9, elapsedMs: 0, tokens: 0, costUsd: 0 }, limits: { ...DEFAULT_LIMITS, maxAttempts: 1 } } }, // budget → budget_exhausted
      { from: "diagnosing", over: { plan: { diag: { hint: "transient" }, need: { capabilities: [] } } } }, // → waiting_backoff
      { from: "diagnosing", over: { plan: { diag: { policyBlocked: true } } } }, // → approval_required
      { from: "diagnosing", over: { plan: { diag: { error: "falta credencial" } } } }, // → materially_blocked
      { from: "decomposing", over: { plan: { subtasks: [{ id: "a", title: "a", deps: [] }], parentAutonomy: "A2" } } }, // → executing
      { from: "decomposing", over: { plan: { subtasks: [{ id: "a", title: "a", deps: [], maxAutonomy: "A4" }], parentAutonomy: "A2" } } } // → materially_blocked
    ];
    for (const c of cases) {
      const rs = makeRunStep(mkPrisma() as any, mkDeps(c.deps));
      const r = await rs(orch({ state: c.from, ...(c.over ?? {}) }));
      expect(canTransition(c.from, r.to), `${c.from} → ${r.to} debe ser válida`).toBe(true);
    }
  });
});
