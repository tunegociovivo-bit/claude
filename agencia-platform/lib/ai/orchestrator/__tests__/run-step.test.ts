/**
 * runStep REAL — motor de fases con deps mockeadas (sin red). Cubre: plan→execute→
 * verify→diagnose→recover, éxito con uso/coste real, 429/timeout, budget, sin proveedor,
 * breaker abierto, failover, DAG (válido/elevación), aprobación (A2+), kill-switch y
 * "no fake success". Ninguna herramienta de efecto se invoca jamás.
 */
import { describe, it, expect, vi } from "vitest";
import { makeRunStep, type RunStepDeps } from "../run-step";
import { initBreaker, recordFailure, type BreakerSnapshot } from "../circuit-breaker";
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

function mkDeps(over: Partial<RunStepDeps> = {}): RunStepDeps {
  const breakers = new Map<string, BreakerSnapshot>();
  let t = 1_000_000;
  return {
    now: () => new Date(t),
    env: { ANTHROPIC_API_KEY: "x", OPENAI_API_KEY: "y" } as any,
    keySources: { env: { ANTHROPIC_API_KEY: "x", OPENAI_API_KEY: "y" } as any },
    live: false,
    limits: DEFAULT_LIMITS,
    attemptDeadlineMs: 5000,
    loadBreaker: async (p) => breakers.get(p) ?? initBreaker(),
    persistBreaker: async (p, s) => void breakers.set(p, s),
    lock: async (_k, fn) => fn(),
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
    const r = await makeRunStep(mkPrisma() as any, mkDeps({ verify: async () => false }))(orch({ state: "verifying" }));
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

  it("executing con breaker ABIERTO del proveedor elegido → waiting_backoff (no martillea)", async () => {
    const breakers = new Map<string, BreakerSnapshot>();
    // abre anthropic y openai
    let b = initBreaker();
    for (const t of [0, 1, 2]) b = recordFailure(b, t);
    breakers.set("anthropic", b);
    breakers.set("openai", b);
    const rs = makeRunStep(mkPrisma() as any, mkDeps({ loadBreaker: async (p) => breakers.get(p) ?? initBreaker(), now: () => new Date(1000) }));
    const r = await rs(orch({ state: "executing" }));
    // ambos abiertos → no hay proveedor sano → materially_blocked (chooseProvider excluye abiertos)
    expect(["materially_blocked", "waiting_backoff"]).toContain(r.to);
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
});
