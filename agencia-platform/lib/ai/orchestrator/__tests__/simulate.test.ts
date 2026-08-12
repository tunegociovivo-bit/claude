/**
 * Slice 2c.3 — simulador SHADOW del bucle de recuperación: éxito, verificación
 * fallida→recupera, transitorio→reintenta, proveedor→fallback, datos faltantes→
 * bloqueo material, política→aprobación, presupuesto agotado, escenario agotado.
 * Determinista (rand inyectado). Ninguna ejecución real.
 */
import { describe, it, expect } from "vitest";
import { simulateRun, type AttemptOutcome } from "../simulate";
import { DEFAULT_LIMITS } from "../budget";

const cfg = (over: any = {}) => ({ rand: () => 0.5, limits: DEFAULT_LIMITS, strategyCtx: { tried: [], canDecompose: true, availableProviders: [{ provider: "openai", model: "gpt" }] }, ...over });

describe("simulateRun", () => {
  it("éxito inmediato → completed", () => {
    const r = simulateRun([{ ok: true }], cfg());
    expect(r.finalState).toBe("completed");
    expect(r.steps.some((s) => s.phase === "verifying")).toBe(true);
    expect(r.steps[r.steps.length - 1].phase).toBe("completed");
  });

  it("verificación falla y luego pasa → recupera y completa", () => {
    const r = simulateRun([{ ok: true, verifyOk: false }, { ok: true }], cfg());
    expect(r.finalState).toBe("completed");
    expect(r.steps.some((s) => s.phase === "diagnosing" && s.diagnosis === "verification_failed")).toBe(true);
  });

  it("fallo transitorio (timeout) → reintenta → completa", () => {
    const r = simulateRun([{ ok: false, diagnosis: { hint: "transient", error: "ETIMEDOUT" } }, { ok: true }], cfg());
    expect(r.finalState).toBe("completed");
    expect(r.steps.some((s) => s.phase === "waiting_backoff")).toBe(true);
  });

  it("fallo de proveedor → cambia de proveedor → completa", () => {
    const r = simulateRun([{ ok: false, diagnosis: { hint: "provider" }, provider: "anthropic" }, { ok: true }], cfg());
    expect(r.finalState).toBe("completed");
    // la 2ª ejecución usa una estrategia distinta (switch_provider)
    const execs = r.steps.filter((s) => s.phase === "executing" && s.ok != null);
    expect(execs.length).toBe(2);
  });

  it("datos faltantes → bloqueo material con decision packet", () => {
    const r = simulateRun([{ ok: false, diagnosis: { error: "falta credencial no configurada" } }], cfg());
    expect(r.finalState).toBe("materially_blocked");
    expect(r.decision?.cause).toBe("missing_data");
    expect(r.decision?.decision).toBeTruthy();
  });

  it("política → requiere aprobación", () => {
    const r = simulateRun([{ ok: false, diagnosis: { policyBlocked: true } }], cfg());
    expect(r.finalState).toBe("approval_required");
    expect(r.decision?.cause).toBe("policy_approval");
  });

  it("presupuesto agotado (intentos) → budget_exhausted", () => {
    const scenario: AttemptOutcome[] = Array.from({ length: 8 }, () => ({ ok: false, diagnosis: { hint: "tool" } }));
    const r = simulateRun(scenario, cfg({ limits: { ...DEFAULT_LIMITS, maxAttempts: 3 } }));
    expect(r.finalState).toBe("budget_exhausted");
    expect(r.decision?.cause).toBe("budget_exhausted");
    expect(r.usage.attempts).toBeLessThanOrEqual(3);
  });

  it("escenario agotado sin resolver → materially_blocked", () => {
    // 2 fallos de herramienta con muy pocas estrategias y sin más escenario
    const r = simulateRun([{ ok: false, diagnosis: { hint: "tool" } }], cfg({ strategyCtx: { tried: [], canDecompose: false, availableProviders: [] } }));
    expect(["materially_blocked", "budget_exhausted"]).toContain(r.finalState);
    expect(r.decision).toBeTruthy();
  });

  it("determinista: mismas entradas → misma traza", () => {
    const s: AttemptOutcome[] = [{ ok: false, diagnosis: { hint: "transient" } }, { ok: true }];
    expect(JSON.stringify(simulateRun(s, cfg()).steps)).toBe(JSON.stringify(simulateRun(s, cfg()).steps));
  });

  it("nunca marca 'executed': el simulador no ejecuta nada (solo traza de estados)", () => {
    const r = simulateRun([{ ok: true }], cfg());
    // no hay campo executed:true en ningún paso; solo fases del plano de control
    expect(JSON.stringify(r)).not.toMatch(/"executed":true/);
  });
});
