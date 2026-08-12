/**
 * Slice 2c — persistencia: transiciones validadas + concurrency-safe + tenant +
 * idempotencia; log append-only; aprobaciones vivas.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { transition, ensureOrchestration, appendStep, liveApprovals } from "../store";

function mkPrisma() {
  return {
    aiOrchestration: { updateMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    aiRunStep: { findFirst: vi.fn(), create: vi.fn() },
    aiApproval: { findMany: vi.fn() }
  };
}
let prisma: ReturnType<typeof mkPrisma>;
beforeEach(() => {
  prisma = mkPrisma();
});

describe("transition — validada, optimista, tenant-scoped", () => {
  it("transición inválida se rechaza ANTES de tocar la BD", async () => {
    const r = await transition(prisma as any, { id: "o1", workspaceId: "w1", from: "queued", to: "completed", expectedVersion: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid");
    expect(prisma.aiOrchestration.updateMany).not.toHaveBeenCalled();
  });

  it("transición válida aplica con version+state en el where (concurrency) y workspaceId (tenant)", async () => {
    prisma.aiOrchestration.updateMany.mockResolvedValue({ count: 1 });
    const r = await transition(prisma as any, { id: "o1", workspaceId: "w1", from: "queued", to: "planning", expectedVersion: 0, patch: { strategy: "x" } });
    expect(r.ok).toBe(true);
    const call = prisma.aiOrchestration.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ id: "o1", workspaceId: "w1", version: 0, state: "queued" });
    expect(call.data).toMatchObject({ state: "planning", version: 1, strategy: "x" });
  });

  it("carrera perdida (count 0) con fila existente → stale (no se pisa)", async () => {
    prisma.aiOrchestration.updateMany.mockResolvedValue({ count: 0 });
    prisma.aiOrchestration.findFirst.mockResolvedValue({ id: "o1" });
    const r = await transition(prisma as any, { id: "o1", workspaceId: "w1", from: "queued", to: "planning", expectedVersion: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("stale");
  });

  it("fila inexistente → not_found", async () => {
    prisma.aiOrchestration.updateMany.mockResolvedValue({ count: 0 });
    prisma.aiOrchestration.findFirst.mockResolvedValue(null);
    const r = await transition(prisma as any, { id: "o1", workspaceId: "w1", from: "queued", to: "planning", expectedVersion: 0 });
    if (!r.ok) expect(r.reason).toBe("not_found");
  });

  it("FAIL-SAFE: descarta claves de patch no reconocidas (`provider`) para no reventar el updateMany", async () => {
    // Regresión del bug del canary LIVE: run atascado en `executing` porque el patch traía
    // `provider` (no es columna de AiOrchestration) → PrismaClientValidationError. Ahora la
    // clave ajena se descarta y la transición aplica limpia.
    prisma.aiOrchestration.updateMany.mockResolvedValue({ count: 1 });
    const r = await transition(prisma as any, {
      id: "o1", workspaceId: "w1", from: "executing", to: "verifying", expectedVersion: 3,
      // `as any`: en producción el patch llega por el borde `any` de runStep (por eso el
      // tipo no atrapó `provider`); aquí reproducimos ese runtime shape ajeno a propósito.
      patch: { usage: { attempts: 1 }, provider: "anthropic", plan: { lastProvider: "anthropic" }, bogus: 1 } as any
    });
    expect(r.ok).toBe(true);
    const data = prisma.aiOrchestration.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({ state: "verifying", version: 4, usage: { attempts: 1 }, plan: { lastProvider: "anthropic" } });
    expect(data).not.toHaveProperty("provider"); // clave ajena NO llega a Prisma
    expect(data).not.toHaveProperty("bogus");
  });
});

describe("ensureOrchestration — idempotente", () => {
  it("crea si no existe", async () => {
    prisma.aiOrchestration.create.mockResolvedValue({ id: "o1", state: "queued" });
    const o = await ensureOrchestration(prisma as any, { workspaceId: "w1", taskId: "t1" });
    expect(o.id).toBe("o1");
    expect(prisma.aiOrchestration.create.mock.calls[0][0].data.workspaceId).toBe("w1");
  });
  it("carrera de creación (P2002) → recupera la existente (no duplica)", async () => {
    prisma.aiOrchestration.create.mockRejectedValue({ code: "P2002" });
    prisma.aiOrchestration.findFirst.mockResolvedValue({ id: "existing", state: "executing" });
    const o = await ensureOrchestration(prisma as any, { workspaceId: "w1", taskId: "t1" });
    expect(o.id).toBe("existing");
    // tenant en la recuperación
    expect(prisma.aiOrchestration.findFirst.mock.calls[0][0].where).toMatchObject({ workspaceId: "w1", taskId: "t1" });
  });
});

describe("appendStep — seq monótono (append-only)", () => {
  it("primer paso seq=0; siguiente = last+1", async () => {
    prisma.aiRunStep.findFirst.mockResolvedValueOnce(null);
    prisma.aiRunStep.create.mockResolvedValue({});
    const a = await appendStep(prisma as any, { workspaceId: "w1", orchestrationId: "o1", phase: "executing" });
    expect(a.seq).toBe(0);
    prisma.aiRunStep.findFirst.mockResolvedValueOnce({ seq: 4 });
    const b = await appendStep(prisma as any, { workspaceId: "w1", orchestrationId: "o1", phase: "verifying" });
    expect(b.seq).toBe(5);
    // tenant en el create
    expect(prisma.aiRunStep.create.mock.calls[0][0].data.workspaceId).toBe("w1");
  });
});

describe("appendStep — M1 fail-loud + redacción estructural", () => {
  it("agotados los reintentos de seq (P2002 siempre) → LANZA (no fabrica seq)", async () => {
    prisma.aiRunStep.findFirst.mockResolvedValue(null);
    prisma.aiRunStep.create.mockRejectedValue({ code: "P2002" });
    await expect(appendStep(prisma as any, { workspaceId: "w1", orchestrationId: "o1", phase: "executing" })).rejects.toThrow(/no se pudo asignar seq/i);
  });
  it("redacta PII del error crudo y de la evidencia antes de escribir", async () => {
    prisma.aiRunStep.findFirst.mockResolvedValue(null);
    prisma.aiRunStep.create.mockResolvedValue({});
    await appendStep(prisma as any, { workspaceId: "w1", orchestrationId: "o1", phase: "diagnosing", error: "clave sk-abcdefghijklmnopqrstuvwx", evidence: { note: "email ana@acme.es" } });
    const data = prisma.aiRunStep.create.mock.calls[0][0].data;
    expect(data.error).not.toMatch(/sk-abcdefghijklmnopqrstuvwx/);
    expect(JSON.stringify(data.evidence)).not.toMatch(/ana@acme\.es/);
    expect(JSON.stringify(data.evidence)).toContain("«EMAIL»");
  });
});

describe("liveApprovals — tenant + solo vivas", () => {
  it("consulta scoped por workspace, no revocadas y no caducadas", async () => {
    prisma.aiApproval.findMany.mockResolvedValue([]);
    await liveApprovals(prisma as any, "w1", new Date("2026-08-11T00:00:00Z"));
    const where = prisma.aiApproval.findMany.mock.calls[0][0].where;
    expect(where.workspaceId).toBe("w1");
    expect(where.revokedAt).toBeNull();
    expect(where.OR).toBeTruthy();
  });
});
