import { describe, it, expect } from "vitest";
import { computeActionPriority, computeActionTransition, autopilotPlan, OPEN_ACTION_STATUSES } from "../actions";

describe("computeActionPriority", () => {
  it("más impacto/confianza y menos esfuerzo → mayor prioridad", () => {
    const easy = computeActionPriority({ impact: 80, effort: 10, confidence: 90 });
    const hard = computeActionPriority({ impact: 80, effort: 90, confidence: 90 });
    expect(easy).toBeGreaterThan(hard);
  });
  it("esfuerzo 0 no rompe (se trata como 1)", () => {
    expect(Number.isFinite(computeActionPriority({ impact: 50, effort: 0, confidence: 50 }))).toBe(true);
  });
});

describe("computeActionTransition — reglas de aprobación", () => {
  const internal = { status: "suggested" as const, external: false, requiresApproval: false };
  const external = { status: "suggested" as const, external: true, requiresApproval: true };

  it("interna: suggested → prepare → prepared", () => {
    expect(computeActionTransition(internal, "prepare")).toMatchObject({ ok: true, next: "prepared" });
  });
  it("aprobar SIN actor humano falla", () => {
    expect(computeActionTransition({ ...internal, status: "needs_approval" }, "approve").ok).toBe(false);
  });
  it("aprobar con actor humano ok", () => {
    expect(computeActionTransition({ ...internal, status: "needs_approval" }, "approve", { actorId: "u1" })).toMatchObject({ ok: true, next: "approved" });
  });
  it("EXTERNA no se aprueba sin pasar por needs_approval", () => {
    const r = computeActionTransition(external, "approve", { actorId: "u1" });
    expect(r.ok).toBe(false);
  });
  it("EXTERNA: suggested → request_approval → needs_approval → approve → execute", () => {
    expect(computeActionTransition(external, "request_approval")).toMatchObject({ ok: true, next: "needs_approval" });
    expect(computeActionTransition({ ...external, status: "needs_approval" }, "approve", { actorId: "u1" })).toMatchObject({ ok: true, next: "approved" });
    expect(computeActionTransition({ ...external, status: "approved" }, "execute")).toMatchObject({ ok: true, next: "executing" });
  });
  it("transición inválida se rechaza", () => {
    expect(computeActionTransition(internal, "publish" as any).ok).toBe(false);
    expect(computeActionTransition({ ...internal, status: "done" }, "execute").ok).toBe(false);
  });
});

describe("autopilotPlan — autonomía por modo", () => {
  it("suggest_only: no hace nada con internas", () => {
    expect(autopilotPlan({ status: "suggested", external: false }, "suggest_only")).toEqual([]);
  });
  it("prepare_drafts: prepara internas, nada más", () => {
    expect(autopilotPlan({ status: "suggested", external: false }, "prepare_drafts")).toEqual(["prepare"]);
    expect(autopilotPlan({ status: "prepared", external: false }, "prepare_drafts")).toEqual([]);
  });
  it("execute_safe: lleva internas hasta done", () => {
    expect(autopilotPlan({ status: "suggested", external: false }, "execute_safe")).toEqual(["prepare", "approve", "execute", "complete"]);
  });
  it("EXTERNA: como mucho a needs_approval en cualquier modo", () => {
    expect(autopilotPlan({ status: "suggested", external: true }, "execute_safe")).toEqual(["request_approval"]);
    expect(autopilotPlan({ status: "needs_approval", external: true }, "execute_safe")).toEqual([]);
  });
  it("OPEN_ACTION_STATUSES no incluye done/dismissed", () => {
    expect(OPEN_ACTION_STATUSES).not.toContain("done");
    expect(OPEN_ACTION_STATUSES).not.toContain("dismissed");
  });
});
