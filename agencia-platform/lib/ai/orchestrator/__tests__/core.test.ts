/**
 * Slice 2c — núcleo: máquina de estados, backoff, presupuesto, huellas/bucles.
 */
import { describe, it, expect } from "vitest";
import { canTransition, isTerminal, nextStates, ORCH_STATES, type OrchState } from "../state-machine";
import { backoffMs } from "../backoff";
import { budgetStatus, sanitizeLimits, DEFAULT_LIMITS } from "../budget";
import { fingerprint, isLooping, normalizeError, fingerprintCounts } from "../fingerprint";

describe("state-machine", () => {
  it("transiciones válidas felices", () => {
    expect(canTransition("queued", "planning")).toBe(true);
    expect(canTransition("planning", "executing")).toBe(true);
    expect(canTransition("executing", "verifying")).toBe(true);
    expect(canTransition("verifying", "completed")).toBe(true);
    expect(canTransition("diagnosing", "waiting_backoff")).toBe(true);
    expect(canTransition("waiting_backoff", "executing")).toBe(true);
  });
  it("rechaza transiciones inválidas", () => {
    expect(canTransition("queued", "completed")).toBe(false);
    expect(canTransition("executing", "completed")).toBe(false); // debe verificar antes
    expect(canTransition("planning", "verifying")).toBe(false);
    expect(canTransition("completed", "planning")).toBe(false); // terminal
  });
  it("no self-loops", () => {
    for (const s of ORCH_STATES) expect(canTransition(s, s)).toBe(false);
  });
  it("cancelable desde cualquier NO terminal; terminales no salen", () => {
    for (const s of ORCH_STATES) {
      if (isTerminal(s)) {
        expect(canTransition(s, "cancelled")).toBe(false);
        expect(nextStates(s)).toEqual([]);
      } else {
        expect(canTransition(s, "cancelled")).toBe(true);
      }
    }
  });
  it("terminales", () => {
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("materially_blocked")).toBe(true);
    expect(isTerminal("budget_exhausted")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
    expect(isTerminal("executing")).toBe(false);
  });
});

describe("backoff", () => {
  it("determinista con jitter=0 (crece exponencial, con techo)", () => {
    const o = { baseMs: 100, factor: 2, maxMs: 1000, jitter: 0 };
    expect(backoffMs(0, o)).toBe(100);
    expect(backoffMs(1, o)).toBe(200);
    expect(backoffMs(2, o)).toBe(400);
    expect(backoffMs(10, o)).toBe(1000); // techo
  });
  it("con jitter acotado por [fixed, cap] usando rand inyectado", () => {
    const o = { baseMs: 100, factor: 2, maxMs: 1000, jitter: 0.5 };
    // rand=0 → mínimo (fixed = cap*0.5); rand=1 → cap
    expect(backoffMs(0, o, () => 0)).toBe(50);
    expect(backoffMs(0, o, () => 1)).toBe(100);
    const mid = backoffMs(0, o, () => 0.5);
    expect(mid).toBeGreaterThanOrEqual(50);
    expect(mid).toBeLessThanOrEqual(100);
  });
});

describe("budget", () => {
  it("agota por cada dimensión, en orden attempts→wall→tokens→cost", () => {
    expect(budgetStatus({ attempts: 6, elapsedMs: 0, tokens: 0, costUsd: 0 }, DEFAULT_LIMITS).reason).toBe("attempts");
    expect(budgetStatus({ attempts: 0, elapsedMs: 999_999_999, tokens: 0, costUsd: 0 }, DEFAULT_LIMITS).reason).toBe("wall");
    expect(budgetStatus({ attempts: 0, elapsedMs: 0, tokens: 999_999, costUsd: 0 }, DEFAULT_LIMITS).reason).toBe("tokens");
    expect(budgetStatus({ attempts: 0, elapsedMs: 0, tokens: 0, costUsd: 99 }, DEFAULT_LIMITS).reason).toBe("cost");
  });
  it("no agotado → remaining positivo", () => {
    const s = budgetStatus({ attempts: 1, elapsedMs: 1000, tokens: 100, costUsd: 0.1 }, DEFAULT_LIMITS);
    expect(s.exhausted).toBe(false);
    expect(s.remaining.attempts).toBe(DEFAULT_LIMITS.maxAttempts - 1);
  });
  it("sanitizeLimits repara valores inválidos", () => {
    const l = sanitizeLimits({ maxAttempts: -3, maxCostUsd: NaN as any });
    expect(l.maxAttempts).toBe(DEFAULT_LIMITS.maxAttempts);
    expect(l.maxCostUsd).toBe(DEFAULT_LIMITS.maxCostUsd);
  });
});

describe("fingerprint / loop", () => {
  it("normaliza ids/números para que 'el mismo fallo' colisione", () => {
    const a = fingerprint({ phase: "executing", strategy: "retry_same", error: "timeout on task 12345 id ab12cd34ef56ab78" });
    const b = fingerprint({ phase: "executing", strategy: "retry_same", error: "timeout on task 99999 id ff00ff00ff00ff00" });
    expect(a).toBe(b);
    expect(normalizeError("Error 500 at 2026")).toContain("<n>");
  });
  it("detecta bucle al alcanzar el umbral", () => {
    const fp = "x";
    expect(isLooping([], fp, 3)).toBe(false);
    expect(isLooping(["x"], fp, 3)).toBe(false);
    expect(isLooping(["x", "x"], fp, 3)).toBe(true); // +actual = 3
    expect(fingerprintCounts(["x", "x", "y"])).toEqual({ x: 2, y: 1 });
  });
});
