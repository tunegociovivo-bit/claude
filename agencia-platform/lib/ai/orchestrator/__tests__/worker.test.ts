/**
 * G2 — worker durable: claim con lease (sin doble toma), recuperación tras reinicio
 * (lease expirado se re-toma), resume tras aprobación, avance de un paso con kill-switch,
 * liberación del lease al terminar. Prisma mock; sin red ni scheduler real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { claimDue, resumeContext, resumeAfterApproval, stepOrchestration, RESUMABLE_STATES } from "../worker";

function mkPrisma(rows: any[]) {
  const store = rows.map((r) => ({ version: 0, leaseOwner: null, leaseExpiresAt: null, ...r }));
  return {
    _rows: store,
    aiOrchestration: {
      findMany: vi.fn(async ({ where }: any) => {
        const now = where.OR?.[1]?.nextRunAt?.lte;
        return store.filter((r) => RESUMABLE_STATES.includes(r.state) && (r.nextRunAt == null || (now && r.nextRunAt <= now)) && (r.leaseExpiresAt == null || (now && r.leaseExpiresAt <= now)));
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
  it("estado terminal → libera lease", async () => {
    const prisma = mkPrisma([orch({ state: "executing", leaseOwner: "w", leaseExpiresAt: future })]);
    await stepOrchestration(prisma as any, { runStep: async () => ({ to: "completed" }) }, orch({ state: "executing" }) as any);
    expect(prisma._rows[0].leaseOwner).toBeNull();
  });
  it("no avanza una orquestación ya terminal", async () => {
    const prisma = mkPrisma([orch({ state: "completed" })]);
    const r = await stepOrchestration(prisma as any, { runStep: async () => ({ to: "executing" }) }, orch({ state: "completed" }) as any);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("terminal");
  });
});
