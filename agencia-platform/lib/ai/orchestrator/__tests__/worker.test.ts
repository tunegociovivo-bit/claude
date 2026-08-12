/**
 * G2 — worker durable: claim con lease (sin doble toma), recuperación tras reinicio
 * (lease expirado se re-toma), resume tras aprobación, avance de un paso con kill-switch,
 * liberación del lease al terminar. Prisma mock; sin red ni scheduler real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { claimDue, resumeContext, resumeAfterApproval, stepOrchestration, runBatch, RESUMABLE_STATES } from "../worker";

function mkPrisma(rows: any[]) {
  const store = rows.map((r) => ({ version: 0, leaseOwner: null, leaseExpiresAt: null, ...r }));
  return {
    _rows: store,
    aiOrchestration: {
      findMany: vi.fn(async ({ where }: any) => {
        const now = where.OR?.[1]?.nextRunAt?.lte;
        // Prisma devuelve objetos DESACOPLADOS → copiamos para que un update posterior
        // no mute el candidato leído (si no, claimDue vería la versión ya avanzada).
        return store.filter((r) => RESUMABLE_STATES.includes(r.state) && (r.nextRunAt == null || (now && r.nextRunAt <= now)) && (r.leaseExpiresAt == null || (now && r.leaseExpiresAt <= now))).map((r) => ({ ...r }));
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const r = store.find((x) => x.id === where.id && x.workspaceId === where.workspaceId && (where.version === undefined || x.version === where.version) && (where.leaseOwner === undefined || (x.leaseOwner ?? null) === where.leaseOwner) && (where.state === undefined || x.state === where.state));
        if (!r) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      }),
      findFirst: vi.fn(async ({ where }: any) => store.find((x) => x.id === where.id && x.workspaceId === where.workspaceId) ?? null)
    }
  };
}

const NOW = new Date("2026-08-12T00:00:00Z");
const past = new Date(NOW.getTime() - 1000);
const future = new Date(NOW.getTime() + 60000);

describe("claimDue — lease sin doble toma + recuperación tras reinicio", () => {
  it("reclama filas due y les pone lease (version+1)", async () => {
    const prisma = mkPrisma([{ id: "o1", workspaceId: "w1", state: "waiting_backoff", nextRunAt: past }]);
    const claimed = await claimDue(prisma as any, { owner: "worker-A", now: NOW, leaseMs: 30000 });
    expect(claimed.map((c) => c.id)).toEqual(["o1"]);
    expect(prisma._rows[0].leaseOwner).toBe("worker-A");
    expect(prisma._rows[0].version).toBe(1);
  });
  it("no toma una fila con lease VIVO (otro worker)", async () => {
    const prisma = mkPrisma([{ id: "o1", workspaceId: "w1", state: "executing", nextRunAt: past, leaseOwner: "worker-B", leaseExpiresAt: future }]);
    const claimed = await claimDue(prisma as any, { owner: "worker-A", now: NOW, leaseMs: 30000 });
    expect(claimed).toHaveLength(0);
  });
  it("RE-TOMA una fila cuyo lease EXPIRÓ (recuperación tras reinicio del otro worker)", async () => {
    const prisma = mkPrisma([{ id: "o1", workspaceId: "w1", state: "executing", nextRunAt: past, leaseOwner: "worker-dead", leaseExpiresAt: past }]);
    const claimed = await claimDue(prisma as any, { owner: "worker-A", now: NOW, leaseMs: 30000 });
    expect(claimed.map((c) => c.id)).toEqual(["o1"]);
    expect(prisma._rows[0].leaseOwner).toBe("worker-A");
  });
  it("no toma orquestaciones terminales", async () => {
    const prisma = mkPrisma([{ id: "o1", workspaceId: "w1", state: "completed", nextRunAt: past }]);
    expect(await claimDue(prisma as any, { owner: "w", now: NOW, leaseMs: 30000 })).toHaveLength(0);
  });
});

describe("resumeContext — reconstrucción de estado desde la fila", () => {
  it("recupera usage/fingerprints/strategy persistidos", () => {
    const ctx = resumeContext({ usage: { attempts: 3, elapsedMs: 5000, tokens: 500, costUsd: 0.1 }, fingerprints: ["a", "b"], strategy: "switch_provider" } as any);
    expect(ctx.usage.attempts).toBe(3);
    expect(ctx.fingerprints).toEqual(["a", "b"]);
    expect(ctx.strategyLabel).toBe("switch_provider");
  });
  it("defaults seguros si faltan campos", () => {
    const ctx = resumeContext({} as any);
    expect(ctx.usage.attempts).toBe(0);
    expect(ctx.fingerprints).toEqual([]);
  });
});

describe("resumeAfterApproval — reanuda solo si estaba en approval_required", () => {
  it("pone nextRunAt al presente (tenant-scoped)", async () => {
    const prisma = mkPrisma([{ id: "o1", workspaceId: "w1", state: "approval_required" }]);
    const r = await resumeAfterApproval(prisma as any, { id: "o1", workspaceId: "w1", now: NOW });
    expect(r.ok).toBe(true);
    expect(prisma._rows[0].nextRunAt).toBe(NOW);
  });
  it("no reanuda si no está en approval_required", async () => {
    const prisma = mkPrisma([{ id: "o1", workspaceId: "w1", state: "executing" }]);
    expect((await resumeAfterApproval(prisma as any, { id: "o1", workspaceId: "w1", now: NOW })).ok).toBe(false);
  });
});

describe("stepOrchestration — avance de un paso", () => {
  const orch = (over: any = {}) => ({ id: "o1", workspaceId: "w1", state: "planning", version: 0, ...over });
  it("aplica la transición que produce runStep", async () => {
    const prisma = mkPrisma([orch()]);
    const r = await stepOrchestration(prisma as any, { runStep: async () => ({ to: "executing" }) }, orch() as any);
    expect(r.ok).toBe(true);
    expect(r.to).toBe("executing");
    expect(prisma._rows[0].state).toBe("executing");
  });
  it("kill-switch → cancela sin llamar a runStep", async () => {
    const prisma = mkPrisma([orch()]);
    const runStep = vi.fn();
    const r = await stepOrchestration(prisma as any, { runStep, killSwitch: () => true }, orch() as any);
    expect(runStep).not.toHaveBeenCalled();
    expect(r.to).toBe("cancelled");
    expect(prisma._rows[0].state).toBe("cancelled");
  });
  it("aplica una transición a estado terminal (el lease lo libera runBatch)", async () => {
    const prisma = mkPrisma([orch({ state: "verifying", leaseOwner: "w", leaseExpiresAt: future })]);
    const r = await stepOrchestration(prisma as any, { runStep: async () => ({ to: "completed" }) }, orch({ state: "verifying", leaseOwner: "w" }) as any);
    expect(r.ok).toBe(true);
    expect(r.to).toBe("completed");
    expect(prisma._rows[0].state).toBe("completed");
  });
  it("no avanza una orquestación ya terminal", async () => {
    const prisma = mkPrisma([orch({ state: "completed" })]);
    const r = await stepOrchestration(prisma as any, { runStep: async () => ({ to: "executing" }) }, orch({ state: "completed" }) as any);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("terminal");
  });
  it("HIGH: worker con lease EXPIRADO cuya transición falla NO borra el lease del nuevo dueño", async () => {
    // La fila ya fue re-tomada por worker-B (version 6, dueño B). Worker-A (stale, v5)
    // intenta cerrar: su transition falla (count 0) y NO debe tocar el lease de B.
    const prisma = mkPrisma([orch({ state: "verifying", version: 6, leaseOwner: "worker-B", leaseExpiresAt: future })]);
    const stale = orch({ state: "verifying", version: 5, leaseOwner: "worker-A" });
    const r = await stepOrchestration(prisma as any, { runStep: async () => ({ to: "completed" }) }, stale as any);
    expect(r.ok).toBe(false); // stale
    expect(prisma._rows[0].leaseOwner).toBe("worker-B"); // lease de B intacto
    expect(prisma._rows[0].leaseExpiresAt).toBe(future);
  });
  it("releaseLease solo libera si seguimos siendo el dueño (guard de owner)", async () => {
    const prisma = mkPrisma([orch({ state: "executing", leaseOwner: "worker-B", leaseExpiresAt: future })]);
    const { releaseLease } = await import("../worker");
    const r = await releaseLease(prisma as any, { id: "o1", workspaceId: "w1", leaseOwner: "worker-A" });
    expect(r.released).toBe(false); // no somos B → no tocamos nada
    expect(prisma._rows[0].leaseOwner).toBe("worker-B");
  });

  it("REGRESIÓN canary: patch con `provider` (no columna) ya NO atasca el run → transiciona a verifying", async () => {
    const prisma = mkPrisma([orch({ state: "executing", version: 2, plan: {}, usage: { attempts: 0 } })]);
    const runStep = async () => ({ to: "verifying" as const, patch: { usage: { attempts: 1 }, provider: "anthropic", plan: { lastProvider: "anthropic" } } });
    const r = await stepOrchestration(prisma as any, { runStep, now: () => NOW }, orch({ state: "executing", version: 2, plan: {}, usage: { attempts: 0 } }) as any);
    expect(r.ok).toBe(true);
    expect(r.to).toBe("verifying");
    const row = prisma._rows[0];
    expect(row.state).toBe("verifying");
    expect(row.usage).toEqual({ attempts: 1 }); // el intento SÍ se contabiliza (ya no se pierde)
    expect(row).not.toHaveProperty("provider"); // la clave ajena nunca se escribe
  });
  it("FAIL-SAFE: runStep que LANZA no deja el run atascado → backoff diferido + error durable", async () => {
    const prisma = mkPrisma([orch({ state: "executing", version: 2, plan: {} })]);
    const runStep = vi.fn(async () => { const e: any = new Error("bad"); e.name = "PrismaClientValidationError"; throw e; });
    const r = await stepOrchestration(prisma as any, { runStep, now: () => NOW }, orch({ state: "executing", version: 2, plan: {} }) as any);
    expect(r.ok).toBe(true);
    expect(r.to).toBe("executing"); // mismo estado, pero diferido (no re-ejecuta ya)
    expect(r.reason).toBe("failsafe_backoff");
    const row = prisma._rows[0];
    expect(row.plan.stepErrors).toBe(1);
    expect(row.lastError).toBe("PrismaClientValidationError");
    expect(row.nextRunAt).toEqual(new Date(NOW.getTime() + 60_000));
    expect(row.version).toBe(3);
  });
  it("FAIL-SAFE: al superar el tope de errores escala a materially_blocked y suelta el lease", async () => {
    const prisma = mkPrisma([orch({ state: "executing", version: 2, plan: { stepErrors: 2 }, leaseOwner: "worker-A", leaseExpiresAt: future })]);
    const runStep = vi.fn(async () => { throw new Error("boom"); });
    const r = await stepOrchestration(prisma as any, { runStep, now: () => NOW }, orch({ state: "executing", version: 2, plan: { stepErrors: 2 }, leaseOwner: "worker-A" }) as any);
    expect(r.ok).toBe(true);
    expect(r.to).toBe("materially_blocked");
    expect(r.reason).toBe("failsafe_blocked");
    const row = prisma._rows[0];
    expect(row.state).toBe("materially_blocked");
    expect(row.plan.stepErrors).toBe(3);
    expect(row.leaseOwner).toBeNull(); // lease liberado al terminar
  });
  it("FAIL-SAFE: un paso EXITOSO resetea stepErrors (consecutivos, no de por vida)", async () => {
    const prisma = mkPrisma([orch({ state: "executing", version: 2, plan: { stepErrors: 2, foo: "bar" }, usage: { attempts: 0 } })]);
    const runStep = async () => ({ to: "verifying" as const, patch: { usage: { attempts: 1 }, plan: { foo: "bar", lastProvider: "anthropic" } } });
    const r = await stepOrchestration(prisma as any, { runStep, now: () => NOW }, orch({ state: "executing", version: 2, plan: { stepErrors: 2, foo: "bar" } }) as any);
    expect(r.ok).toBe(true);
    expect(r.to).toBe("verifying");
    const row = prisma._rows[0];
    expect(row.plan).not.toHaveProperty("stepErrors"); // reseteado en el paso exitoso
    expect(row.plan.foo).toBe("bar"); // el resto del plan intacto
  });
  it("FAIL-SAFE guardado por versión: si otro worker ya movió la fila, no se pisa", async () => {
    // La fila está en v6 (otro worker); nuestro paso (v2) lanza → failSafeRecover con
    // where.version=2 no matchea → count 0 → ok:false, sin tocar la fila.
    const prisma = mkPrisma([orch({ state: "verifying", version: 6 })]);
    const runStep = vi.fn(async () => { throw new Error("boom"); });
    const r = await stepOrchestration(prisma as any, { runStep, now: () => NOW }, orch({ state: "executing", version: 2, plan: {} }) as any);
    expect(r.ok).toBe(false);
    expect(prisma._rows[0].version).toBe(6); // intacta
  });
});

describe("runBatch — lote acotado, aislamiento de errores, libera lease", () => {
  const reload = (prisma: any) => async (o: any) => prisma._rows.find((r: any) => r.id === o.id && r.workspaceId === o.workspaceId) ?? null;
  it("avanza runs due hasta terminal/park y libera lease; agregado correcto", async () => {
    const prisma = mkPrisma([
      { id: "o1", workspaceId: "w1", state: "verifying", nextRunAt: past },
      { id: "o2", workspaceId: "w2", state: "diagnosing", nextRunAt: past }
    ]);
    // runStep: verifying→completed; diagnosing→waiting_backoff (park)
    const runStep = async (o: any) => (o.state === "verifying" ? { to: "completed" } : { to: "waiting_backoff", patch: { nextRunAt: future } }) as any;
    const res = await runBatch(prisma as any, { runStep, now: () => NOW, owner: "W", leaseMs: 30000 }, reload(prisma));
    expect(res.claimed).toBe(2);
    expect(res.completed).toBe(1);
    expect(res.parked).toBe(1);
    expect(res.advanced).toBe(2);
    // leases liberados
    expect(prisma._rows.every((r: any) => r.leaseOwner === null)).toBe(true);
  });
  it("un run que lanza NO bloquea el resto del lote (error parcial)", async () => {
    const prisma = mkPrisma([
      { id: "o1", workspaceId: "w1", state: "verifying", nextRunAt: past },
      { id: "o2", workspaceId: "w2", state: "verifying", nextRunAt: past }
    ]);
    const runStep = async (o: any) => { if (o.id === "o1") throw new Error("boom"); return { to: "completed" } as any; };
    const res = await runBatch(prisma as any, { runStep, now: () => NOW, owner: "W", leaseMs: 30000 }, reload(prisma));
    expect(res.errors).toBe(1);
    expect(res.completed).toBe(1); // o2 igual completó
    expect(prisma._rows.every((r: any) => r.leaseOwner === null)).toBe(true); // ambos leases liberados
  });
  it("acota por maxStepsPerRun (no bucle infinito)", async () => {
    const prisma = mkPrisma([{ id: "o1", workspaceId: "w1", state: "executing", nextRunAt: past }]);
    // runStep siempre devuelve executing→verifying→executing... nunca terminal
    const runStep = async (o: any) => ({ to: o.state === "executing" ? "verifying" : "executing" }) as any;
    const res = await runBatch(prisma as any, { runStep, now: () => NOW, owner: "W", leaseMs: 30000, maxStepsPerRun: 4 }, reload(prisma));
    expect(res.steps).toBeLessThanOrEqual(4);
  });
  it("MEDIUM #4: no arranca un paso si no cabe el intento en el presupuesto del lote", async () => {
    const prisma = mkPrisma([{ id: "o1", workspaceId: "w1", state: "verifying", nextRunAt: past }]);
    const runStep = vi.fn(async () => ({ to: "completed" }) as any);
    // maxWallMs 10s, attemptBudgetMs 15s → ningún paso cabe → no se ejecuta runStep
    const res = await runBatch(prisma as any, { runStep, now: () => NOW, owner: "W", leaseMs: 60000, maxWallMs: 10_000, attemptBudgetMs: 15_000 }, reload(prisma));
    expect(runStep).not.toHaveBeenCalled();
    expect(res.steps).toBe(0);
  });
});
