/**
 * Slice D — persistencia pausa: dry-run no escribe, frase incorrecta bloquea,
 * idempotencia/concurrencia (guard de estado), auditoría, checkpoint, resume,
 * resultado parcial, Holded checklist (verificación explícita, sin mutar Holded).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { previewPause, commitPause, resumeOperation, markPausedInHolded, holdedInventory } from "../pause-store";
import { expectedPhrase } from "../pause-plan";

function mkPrisma() {
  return {
    recurringInvoiceTemplate: { findMany: vi.fn(), updateMany: vi.fn() },
    recurringPauseOperation: { create: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
    auditLog: { create: vi.fn() }
  };
}
let prisma: ReturnType<typeof mkPrisma>;
beforeEach(() => {
  prisma = mkPrisma();
  prisma.recurringPauseOperation.create.mockResolvedValue({ id: "op1" });
  prisma.recurringPauseOperation.updateMany.mockResolvedValue({ count: 1 });
  prisma.auditLog.create.mockResolvedValue({});
});

const statuses = (rows: any[]) => prisma.recurringInvoiceTemplate.findMany.mockResolvedValue(rows);

describe("previewPause — dry-run", () => {
  it("no escribe; devuelve plan + frase", async () => {
    statuses([{ id: "a", status: "active", statusBeforePause: null, clientSnapshot: { name: "Acme" } }]);
    const plan = await previewPause(prisma as any, "w1", "pause", ["a"]);
    expect(plan.count).toBe(1);
    expect(plan.phrase).toBe(expectedPhrase("pause", 1, "w1"));
    expect(prisma.recurringInvoiceTemplate.updateMany).not.toHaveBeenCalled();
    expect(prisma.recurringPauseOperation.create).not.toHaveBeenCalled();
    // tenant
    expect(prisma.recurringInvoiceTemplate.findMany.mock.calls[0][0].where.workspaceId).toBe("w1");
  });
});

describe("commitPause — confirmación fuerte", () => {
  it("frase incorrecta → falla SIN escribir", async () => {
    statuses([{ id: "a", status: "active", statusBeforePause: null, clientSnapshot: null }]);
    const r = await commitPause(prisma as any, "w1", "pause", ["a"], "frase mala", "u1");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("phrase_mismatch");
    expect(prisma.recurringPauseOperation.create).not.toHaveBeenCalled();
    expect(prisma.recurringInvoiceTemplate.updateMany).not.toHaveBeenCalled();
  });

  it("frase correcta → pausa con guard de estado (idempotente), audita, checkpoint", async () => {
    statuses([
      { id: "a", status: "active", statusBeforePause: null, clientSnapshot: null },
      { id: "b", status: "draft", statusBeforePause: null, clientSnapshot: null }
    ]);
    prisma.recurringInvoiceTemplate.updateMany.mockResolvedValue({ count: 1 });
    const phrase = expectedPhrase("pause", 2, "w1");
    const r = await commitPause(prisma as any, "w1", "pause", ["a", "b"], phrase, "u1");
    expect(r.status).toBe("completed");
    expect(r.results.every((x) => x.ok && x.to === "paused")).toBe(true);
    // guard de estado + preserva estado previo + tenant
    const call = prisma.recurringInvoiceTemplate.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ workspaceId: "w1", status: "active" });
    expect(call.data).toMatchObject({ status: "paused", statusBeforePause: "active" });
    // auditoría por plantilla
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(2);
    // checkpoint
    expect(prisma.recurringPauseOperation.updateMany).toHaveBeenCalled();
  });

  it("resultado PARCIAL: una plantilla cambió por concurrencia (count 0)", async () => {
    statuses([
      { id: "a", status: "active", statusBeforePause: null, clientSnapshot: null },
      { id: "b", status: "active", statusBeforePause: null, clientSnapshot: null }
    ]);
    prisma.recurringInvoiceTemplate.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const r = await commitPause(prisma as any, "w1", "pause", ["a", "b"], expectedPhrase("pause", 2, "w1"), "u1");
    expect(r.status).toBe("partial");
    expect(r.results.filter((x) => x.ok)).toHaveLength(1);
    expect(r.results.filter((x) => !x.ok)).toHaveLength(1);
  });

  it("reproceso de una YA pausada → idempotente sin reescribir statusBeforePause", async () => {
    statuses([{ id: "a", status: "paused", statusBeforePause: "active", clientSnapshot: null }]);
    // conteo elegible = 0 (paused no es pausable) → la frase liga a 0
    const r = await commitPause(prisma as any, "w1", "pause", ["a"], expectedPhrase("pause", 0, "w1"), "u1");
    // 0 elegibles → completed sin tocar nada (no reescribe)
    expect(r.status).toBe("completed");
    expect(prisma.recurringInvoiceTemplate.updateMany).not.toHaveBeenCalled();
  });

  it("resume SIN estado previo → no-ok, NO activa por defecto", async () => {
    statuses([{ id: "b", status: "paused", statusBeforePause: null, clientSnapshot: null }]);
    prisma.recurringInvoiceTemplate.updateMany.mockResolvedValue({ count: 1 });
    const r = await commitPause(prisma as any, "w1", "resume", ["b"], expectedPhrase("resume", 1, "w1"), "u1");
    expect(r.results[0].ok).toBe(false);
    expect(r.results[0].error).toMatch(/sin estado previo/);
    expect(prisma.recurringInvoiceTemplate.updateMany).not.toHaveBeenCalled();
  });

  it("fallo de auditoría NO corrompe el resultado (best-effort)", async () => {
    statuses([{ id: "a", status: "active", statusBeforePause: null, clientSnapshot: null }]);
    prisma.recurringInvoiceTemplate.updateMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.create.mockRejectedValue(new Error("audit down"));
    const r = await commitPause(prisma as any, "w1", "pause", ["a"], expectedPhrase("pause", 1, "w1"), "u1");
    expect(r.status).toBe("completed"); // la pausa se aplicó; el audit fallido no la marca partial
    expect(r.results).toHaveLength(1);
    expect(r.results[0].ok).toBe(true);
  });

  it("reanudar restaura el estado PREVIO (draft no se activa)", async () => {
    statuses([{ id: "b", status: "paused", statusBeforePause: "draft", clientSnapshot: null }]);
    prisma.recurringInvoiceTemplate.updateMany.mockResolvedValue({ count: 1 });
    const r = await commitPause(prisma as any, "w1", "resume", ["b"], expectedPhrase("resume", 1, "w1"), "u1");
    expect(r.status).toBe("completed");
    const call = prisma.recurringInvoiceTemplate.updateMany.mock.calls[0][0];
    expect(call.data).toMatchObject({ status: "draft", statusBeforePause: null }); // NO active
  });
});

describe("resumeOperation — checkpoint", () => {
  it("solo procesa los pendientes (no reprocesa el checkpoint)", async () => {
    prisma.recurringPauseOperation.findFirst.mockResolvedValue({ id: "op1", action: "pause", eligibleIds: ["a", "b"], processedIds: ["a"], results: [{ id: "a", ok: true, to: "paused" }] });
    statuses([{ id: "b", status: "active", statusBeforePause: null, clientSnapshot: null }]);
    prisma.recurringInvoiceTemplate.updateMany.mockResolvedValue({ count: 1 });
    const r = await resumeOperation(prisma as any, "w1", "op1", "u1");
    // solo carga/actualiza 'b'
    expect(prisma.recurringInvoiceTemplate.findMany.mock.calls[0][0].where.id).toEqual({ in: ["b"] });
    expect(r.processed).toBe(2); // a (previo) + b (nuevo)
  });
});

describe("Holded checklist — sin mutar Holded", () => {
  it("markPausedInHolded exige verificación explícita", async () => {
    expect((await markPausedInHolded(prisma as any, "w1", ["a"], false, "u1")).updated).toBe(0);
    prisma.recurringInvoiceTemplate.updateMany.mockResolvedValue({ count: 1 });
    const r = await markPausedInHolded(prisma as any, "w1", ["a"], true, "u1", "verificado en panel");
    expect(r.updated).toBe(1);
    const call = prisma.recurringInvoiceTemplate.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ workspaceId: "w1" });
    expect(call.data.pausedInHolded).toBe(true);
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });
  it("inventory: solo activas, CSV scoped por workspace", async () => {
    prisma.recurringInvoiceTemplate.findMany.mockResolvedValue([{ clientSnapshot: { name: "Acme" }, totalCents: 12100, currency: "EUR", intervalMonths: 1, series: "FAC", pausedInHolded: false }]);
    const inv = await holdedInventory(prisma as any, "w1");
    expect(prisma.recurringInvoiceTemplate.findMany.mock.calls[0][0].where).toMatchObject({ workspaceId: "w1", status: "active" });
    expect(inv.csv).toContain("Acme");
  });
});
