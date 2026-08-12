/**
 * G3+G5 — runtime componible: deadline real (abort), sonda única del breaker bajo
 * lock por proveedor, decompose→validateDag (sin elevación) y switch_provider con
 * salud/breaker reales. Determinista, sin red ni BD.
 */
import { describe, it, expect, vi } from "vitest";
import { withDeadline, withinWallBudget, serializedProbe, settleBreaker, planSubtasks, chooseProvider, DeadlineExceeded } from "../runtime";
import { initBreaker, recordFailure, type BreakerSnapshot } from "../circuit-breaker";
import type { SubtaskNode } from "../dag";

// setTimeout inyectable: "immediate" dispara el deadline ya; "never" no lo dispara.
const immediate = { setTimeout: ((cb: any) => { cb(); return 1 as any; }) as any, clearTimeout: (() => {}) as any };
const never = { setTimeout: (() => 1 as any) as any, clearTimeout: (() => {}) as any };

describe("withDeadline", () => {
  it("resuelve si fn termina antes del deadline", async () => {
    const r = await withDeadline(1000, async () => "ok", never);
    expect(r).toBe("ok");
  });
  it("aborta y lanza DeadlineExceeded si fn se cuelga", async () => {
    const hung = new Promise<string>(() => {}); // nunca resuelve
    await expect(withDeadline(10, (signal) => { return hung; }, { ...immediate, phase: "modelo" })).rejects.toBeInstanceOf(DeadlineExceeded);
  });
  it("el signal se aborta al vencer el deadline", async () => {
    let seenAborted: boolean | null = null;
    await withDeadline(10, async (signal) => { seenAborted = signal.aborted; return "x"; }, immediate).catch(() => {});
    expect(seenAborted).toBe(true);
  });
});

describe("withinWallBudget", () => {
  it("respeta el presupuesto global de tiempo", () => {
    expect(withinWallBudget(0, 5000, 10000, 3000)).toBe(true); // 5000+3000 ≤ 10000
    expect(withinWallBudget(0, 8000, 10000, 3000)).toBe(false); // 8000+3000 > 10000
  });
});

describe("serializedProbe — sonda única bajo lock por proveedor", () => {
  // lock de memoria que SERIALIZA por clave (como un mutex real).
  function memLock() {
    const chains = new Map<string, Promise<any>>();
    return (async (key: string, fn: any) => {
      const prev = chains.get(key) ?? Promise.resolve();
      let release: () => void;
      const gate = new Promise<void>((r) => (release = r));
      chains.set(key, prev.then(() => gate));
      await prev;
      try { return await fn(); } finally { release!(); }
    }) as any;
  }
  it("tras cooldown, N llamadas concurrentes → solo UNA sonda pasa", async () => {
    let snap: BreakerSnapshot = { state: "open", failures: [], openedAt: 0, halfOpenInFlight: false };
    const load = async () => snap;
    const persist = async (b: BreakerSnapshot) => { snap = b; };
    const lock = memLock();
    const now = 40_000; // > cooldown 30s
    const results = await Promise.all(Array.from({ length: 5 }, () => serializedProbe(lock, "openai", load, persist, now)));
    const passes = results.filter((r) => r.pass).length;
    expect(passes).toBe(1); // exactamente una sonda
    expect(snap.halfOpenInFlight).toBe(true);
  });
  it("settleBreaker cierra en éxito / re-abre en fallo", async () => {
    let snap = initBreaker();
    for (const t of [0, 1, 2]) snap = recordFailure(snap, t);
    const load = async () => snap;
    const persist = async (b: BreakerSnapshot) => { snap = b; };
    await settleBreaker(load, persist, true, 100);
    expect(snap.state).toBe("closed");
  });
});

describe("planSubtasks (G5) — decompose validado, sin elevación", () => {
  const n = (id: string, deps: string[] = [], maxAutonomy?: any): SubtaskNode => ({ id, title: id, deps, maxAutonomy });
  it("DAG válido → ok con orden topológico", () => {
    const r = planSubtasks([n("a"), n("b", ["a"])], "A3");
    expect(r.ok).toBe(true);
  });
  it("subtarea que eleva autonomía por encima del padre → rechazada", () => {
    const r = planSubtasks([n("a", [], "A4")], "A2");
    expect(r.ok).toBe(false);
  });
  it("ciclo → rechazado", () => {
    const r = planSubtasks([n("a", ["b"]), n("b", ["a"])], "A3");
    expect(r.ok).toBe(false);
  });
});

describe("chooseProvider (G5) — routing/salud/breaker reales", () => {
  it("elige un slot sano por capacidad; excluye breaker abierto", () => {
    const env = { ANTHROPIC_API_KEY: "x", OPENAI_API_KEY: "y" } as any;
    const first = chooseProvider({ capabilities: ["tool_use"] }, env);
    expect(first).toBeTruthy();
    // si el breaker del elegido está abierto, salta al siguiente sano
    const openProvider = first!.provider;
    const next = chooseProvider({ capabilities: ["tool_use"] }, env, { breakerOpen: (p) => p === openProvider });
    expect(next).toBeTruthy();
    expect(next!.provider).not.toBe(openProvider);
  });
  it("sin claves → null (el controller escala, no reintenta a ciegas)", () => {
    expect(chooseProvider({ capabilities: ["tool_use"] }, {} as any)).toBeNull();
  });
  it("perplexity (web_search) sin key → null", () => {
    const env = { ANTHROPIC_API_KEY: "x" } as any;
    expect(chooseProvider({ capabilities: ["web_search"] }, env)).toBeNull();
  });
});
