/**
 * Control de búsquedas: transiciones puras (pausar/reanudar/cancelar), idempotencia,
 * aislamiento por workspace y guarda de concurrencia.
 */
import { describe, it, expect, vi } from "vitest";
import { computeControlTransition, requestSearchControl } from "../search-control";

describe("computeControlTransition — máquina de estados", () => {
  it("pausar RUNNING → PAUSING + señal pause", () => {
    expect(computeControlTransition("RUNNING", "pause")).toEqual({ changed: true, status: "PAUSING", controlSignal: "pause" });
  });
  it("pausar PENDING (sin arrancar) → PAUSED directo", () => {
    expect(computeControlTransition("PENDING", "pause")).toEqual({ changed: true, status: "PAUSED", controlSignal: null });
  });
  it("cancelar RUNNING → CANCELLING + señal cancel", () => {
    expect(computeControlTransition("RUNNING", "cancel")).toEqual({ changed: true, status: "CANCELLING", controlSignal: "cancel" });
  });
  it("cancelar PAUSED (nada en vuelo) → CANCELLED directo", () => {
    expect(computeControlTransition("PAUSED", "cancel")).toEqual({ changed: true, status: "CANCELLED", controlSignal: null });
  });
  it("cancelar gana sobre pausa en curso (PAUSING → CANCELLING)", () => {
    expect(computeControlTransition("PAUSING", "cancel")).toEqual({ changed: true, status: "CANCELLING", controlSignal: "cancel" });
  });
  it("reanudar PAUSED → PENDING (reanuda desde checkpoint)", () => {
    expect(computeControlTransition("PAUSED", "resume")).toEqual({ changed: true, status: "PENDING", controlSignal: null });
  });
  it("IDEMPOTENTE: pausar ya-pausada / cancelar ya-cancelada / reanudar en curso → sin cambio", () => {
    expect(computeControlTransition("PAUSED", "pause").changed).toBe(false);
    expect(computeControlTransition("CANCELLED", "cancel").changed).toBe(false);
    expect(computeControlTransition("RUNNING", "resume").changed).toBe(false);
  });
  it("no se actúa sobre terminales (COMPLETED/FAILED)", () => {
    expect(computeControlTransition("COMPLETED", "pause").changed).toBe(false);
    expect(computeControlTransition("COMPLETED", "cancel").changed).toBe(false);
    expect(computeControlTransition("FAILED", "cancel").changed).toBe(false);
  });
});

function mkPrisma(row: any) {
  return {
    _row: row,
    leadSearch: {
      findFirst: vi.fn(async ({ where }: any) => (row && row.id === where.id && row.workspaceId === where.workspaceId ? { ...row } : null)),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (!row || row.id !== where.id || row.workspaceId !== where.workspaceId) return { count: 0 };
        if (where.status !== undefined && row.status !== where.status) return { count: 0 }; // guarda de concurrencia
        Object.assign(row, data);
        return { count: 1 };
      })
    }
  };
}

describe("requestSearchControl — tenant-scoped, idempotente, guardado por versión", () => {
  it("aplica pausa a una búsqueda del propio workspace", async () => {
    const p = mkPrisma({ id: "s1", workspaceId: "w1", status: "RUNNING", controlSignal: null });
    const out = await requestSearchControl(p as any, "w1", "s1", "pause");
    expect(out).toMatchObject({ ok: true, status: "PAUSING", changed: true });
    expect(p._row.controlSignal).toBe("pause");
  });
  it("búsqueda de OTRO workspace → not found (aislamiento)", async () => {
    const p = mkPrisma({ id: "s1", workspaceId: "w1", status: "RUNNING", controlSignal: null });
    const out = await requestSearchControl(p as any, "attacker", "s1", "cancel");
    expect(out).toEqual({ ok: false, notFound: true });
    expect(p._row.status).toBe("RUNNING"); // intacta
  });
  it("idempotente: cancelar dos veces no rompe (segunda sin cambio)", async () => {
    const p = mkPrisma({ id: "s1", workspaceId: "w1", status: "RUNNING", controlSignal: null });
    await requestSearchControl(p as any, "w1", "s1", "cancel"); // → CANCELLING
    // Simula que el worker ya finalizó a CANCELLED:
    p._row.status = "CANCELLED"; p._row.controlSignal = null;
    const out2 = await requestSearchControl(p as any, "w1", "s1", "cancel");
    expect(out2).toMatchObject({ ok: true, changed: false, status: "CANCELLED" });
  });
});
