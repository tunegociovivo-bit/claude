/**
 * Slice 2c — invariantes de seguridad: DAG (aciclicidad/no elevación), aprobaciones
 * (nunca implícitas), autonomía en shadow (executed:false), routing de proveedores.
 */
import { describe, it, expect } from "vitest";
import { validateDag, type SubtaskNode } from "../dag";
import { evaluateApproval, isApprovalLive, actionMatches, type ApprovalRecord } from "../approvals";
import { shadowEvaluate } from "../autonomy-shadow";
import { slotHealth, routeSlots, availableProviders, MODEL_SLOTS } from "../providers";

const NOW = new Date("2026-08-11T00:00:00.000Z");

describe("dag — acíclico, límites, no elevación de permisos", () => {
  const n = (id: string, deps: string[] = [], maxAutonomy?: any): SubtaskNode => ({ id, title: id, deps, maxAutonomy });
  it("orden topológico de un DAG válido", () => {
    const r = validateDag([n("a"), n("b", ["a"]), n("c", ["b"])], "A3");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.order[0]).toBe("a");
  });
  it("detecta ciclo", () => {
    const r = validateDag([n("a", ["c"]), n("b", ["a"]), n("c", ["b"])], "A3");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ciclo/i);
  });
  it("rechaza límites (nodos/profundidad)", () => {
    const many = Array.from({ length: 30 }, (_, i) => n(`x${i}`));
    expect(validateDag(many, "A3", { maxNodes: 20, maxDepth: 5 }).ok).toBe(false);
    const deep = [n("a"), n("b", ["a"]), n("c", ["b"]), n("d", ["c"]), n("e", ["d"]), n("f", ["e"])];
    expect(validateDag(deep, "A3", { maxNodes: 20, maxDepth: 5 }).ok).toBe(false);
  });
  it("NO permite que una subtarea eleve permisos por encima del padre", () => {
    const r = validateDag([n("a", [], "A4")], "A2");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/autonomía/i);
    // hijo ≤ padre sí
    expect(validateDag([n("a", [], "A1")], "A2").ok).toBe(true);
  });
  it("dependencia inexistente / auto-dependencia", () => {
    expect(validateDag([n("a", ["z"])], "A3").ok).toBe(false);
    expect(validateDag([n("a", ["a"])], "A3").ok).toBe(false);
  });
});

describe("approvals — nunca implícita", () => {
  const a = (o: Partial<ApprovalRecord>): ApprovalRecord => ({ id: "ap1", action: "send_whatsapp_message", ...o });
  it("sin aprobaciones → no aprobado", () => {
    expect(evaluateApproval([], { action: "send_whatsapp_message" }, NOW).approved).toBe(false);
  });
  it("viva y cubre → aprobado; revocada/caducada → no", () => {
    expect(evaluateApproval([a({})], { action: "send_whatsapp_message" }, NOW).approved).toBe(true);
    expect(isApprovalLive(a({ revokedAt: NOW }), NOW)).toBe(false);
    expect(isApprovalLive(a({ expiresAt: new Date(NOW.getTime() - 1) }), NOW)).toBe(false);
    expect(isApprovalLive(a({ remaining: 0 }), NOW)).toBe(false);
  });
  it("respeta importe/volumen/scope", () => {
    const appr = [a({ maxAmountCents: 1000, maxVolume: 5, scope: "c1" })];
    expect(evaluateApproval(appr, { action: "send_whatsapp_message", amountCents: 2000, scope: "c1" }, NOW).approved).toBe(false); // importe supera
    expect(evaluateApproval(appr, { action: "send_whatsapp_message", volume: 10, scope: "c1" }, NOW).approved).toBe(false); // volumen supera
    expect(evaluateApproval(appr, { action: "send_whatsapp_message", scope: "c2" }, NOW).approved).toBe(false); // otro scope
    expect(evaluateApproval(appr, { action: "send_whatsapp_message", amountCents: 500, volume: 2, scope: "c1" }, NOW).approved).toBe(true);
  });
  it("glob de acción", () => {
    expect(actionMatches("*", "x")).toBe(true);
    expect(actionMatches("stripe.*", "stripe.refund")).toBe(true);
    expect(actionMatches("stripe.refund", "stripe.charge")).toBe(false);
  });
});

describe("autonomy-shadow — jamás ejecuta; A4 requiere aprobación", () => {
  const ctx = { workspaceId: "w1", isAdmin: true };
  it("acción sensible (gate) → external, executed:false, requiere aprobación; sin aprobación no allowed", () => {
    const rec = shadowEvaluate({ action: "send_whatsapp_message", input: { to: "x" } }, ctx, [], NOW);
    expect(rec.executed).toBe(false);
    expect(rec.external).toBe(true);
    expect(rec.requiresApproval).toBe(true);
    expect(rec.approvalUsed).toBeNull();
    expect(rec.allowed).toBe(false);
  });
  it("con aprobación viva que cubre → approvalUsed set (pero sigue executed:false en shadow)", () => {
    const appr = [{ id: "ap1", action: "send_whatsapp_message" }];
    const rec = shadowEvaluate({ action: "send_whatsapp_message" }, ctx, appr, NOW);
    expect(rec.executed).toBe(false);
    expect(rec.approvalUsed).toBe("ap1");
  });
  it("acción reversible no sensible no es external", () => {
    const rec = shadowEvaluate({ action: "create_task" }, ctx, [], NOW);
    expect(rec.external).toBe(false);
    expect(rec.executed).toBe(false);
  });
});

describe("providers — slots sin llamadas externas", () => {
  it("salud por presencia de key (sin red)", () => {
    const anthropic = MODEL_SLOTS.find((s) => s.provider === "anthropic")!;
    expect(slotHealth(anthropic, { ANTHROPIC_API_KEY: "sk-x" } as any)).toBe("available");
    expect(slotHealth(anthropic, {} as any)).toBe("unavailable");
  });
  it("routeSlots solo devuelve disponibles que cumplen capacidad", () => {
    const env = { ANTHROPIC_API_KEY: "x" } as any;
    const slots = routeSlots({ capabilities: ["tool_use"] }, env);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => s.provider === "anthropic")).toBe(true); // openai/gemini sin key
    expect(routeSlots({ capabilities: ["web_search"] }, env)).toHaveLength(0); // perplexity sin key
  });
  it("availableProviders vacío sin keys (no rompe)", () => {
    expect(availableProviders({} as any)).toEqual([]);
  });
});
