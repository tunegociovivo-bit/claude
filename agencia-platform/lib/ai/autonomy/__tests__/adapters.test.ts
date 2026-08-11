/**
 * Contrato FASE 4a — adaptadores dry-run: NUNCA ejecutan; sensibles bloqueadas.
 */
import { describe, it, expect } from "vitest";
import { dryRun } from "../adapters";
import { DEFAULT_AUTONOMY_POLICY } from "../policy";

const ctx = { workspaceId: "w1", isAdmin: true };
const pol = { ...DEFAULT_AUTONOMY_POLICY, allowlist: ["send_whatsapp_message", "create_task", "stripe_refund_charge"] };

describe("dryRun", () => {
  it("jamás ejecuta (executed:false, mode dry-run)", () => {
    const r = dryRun({ action: "create_task", risk: "low" }, ctx, pol);
    expect(r.executed).toBe(false);
    expect(r.mode).toBe("dry-run");
  });

  it("acción sensible → external + bloqueada por requerir aprobación", () => {
    const r = dryRun({ action: "send_whatsapp_message", volume: 3 }, ctx, pol);
    expect(r.external).toBe(true);
    expect(r.blocked).toBe(true);
    expect(r.requiresApproval).toBe(true);
    expect(r.blockedReason).toMatch(/aprobaci/i);
  });

  it("reembolso Stripe: external, bloqueado, con clave de idempotencia", () => {
    const r = dryRun({ action: "stripe_refund_charge", amountCents: 5000, clientId: "c1" }, ctx, pol);
    expect(r.external).toBe(true);
    expect(r.blocked).toBe(true);
    expect(r.idempotencyKey).toContain("w1:stripe_refund_charge:c1");
  });

  it("acción reversible no-sensible en allowlist → no bloqueada, no external", () => {
    const r = dryRun({ action: "create_task", risk: "low" }, ctx, pol);
    expect(r.external).toBe(false);
    expect(r.blocked).toBe(false);
    expect(r.wouldDo).toMatch(/dry-run/);
  });
});
