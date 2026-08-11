/**
 * Contrato FASE 4a — autonomía A0–A4 y política determinista.
 * Clave: el modelo NO puede autoelevarse; el nivel lo decide el servidor.
 */
import { describe, it, expect } from "vitest";
import {
  resolveAutonomy,
  effectiveRisk,
  idempotencyKeyFor,
  mergeAutonomyPolicy,
  DEFAULT_AUTONOMY_POLICY,
  type AutonomyPolicy,
  type ActionDescriptor
} from "../policy";

const ctx = { workspaceId: "w1", isAdmin: true };
const policy = (p: Partial<AutonomyPolicy> = {}): AutonomyPolicy => ({ ...DEFAULT_AUTONOMY_POLICY, ...p });

describe("effectiveRisk — el gate de Fase 1 manda", () => {
  it("tools sensibles → 'sensitive' AUNQUE la pista diga lo contrario", () => {
    expect(effectiveRisk({ action: "send_whatsapp_message", risk: "none" })).toBe("sensitive");
    expect(effectiveRisk({ action: "stripe_refund_charge", risk: "low" })).toBe("sensitive");
    expect(effectiveRisk({ action: "make_raw_api", input: { method: "DELETE" }, risk: "none" })).toBe("sensitive");
  });
  it("make_raw_api GET no es sensible; acción benigna respeta pista", () => {
    expect(effectiveRisk({ action: "make_raw_api", input: { method: "GET" } })).toBe("low");
    expect(effectiveRisk({ action: "create_task", risk: "low" })).toBe("low");
  });
});

describe("resolveAutonomy — escalada IMPOSIBLE", () => {
  it("acción sensible → A4 + aprobación, NO autónoma (sin aprobación previa)", () => {
    const d = resolveAutonomy({ action: "stripe_refund_charge", amountCents: 100 }, ctx, policy({ allowlist: ["stripe_refund_charge"] }));
    expect(d.grantedLevel).toBe("A4");
    expect(d.requiresApproval).toBe(true);
    expect(d.allowed).toBe(false);
  });

  it("el modelo NO puede autoelevar: pista risk='none' en tool sensible sigue A4", () => {
    const d = resolveAutonomy({ action: "send_whatsapp_message", risk: "none" } as ActionDescriptor, ctx, policy({ allowlist: ["send_whatsapp_message"] }));
    expect(d.effectiveRisk).toBe("sensitive");
    expect(d.grantedLevel).toBe("A4");
    expect(d.allowed).toBe(false);
  });

  it("con aprobación previa, la sensible puede ejecutarse bajo política", () => {
    const d = resolveAutonomy({ action: "send_whatsapp_message" }, { ...ctx, hasPriorApproval: true }, policy({ allowlist: ["send_whatsapp_message"] }));
    expect(d.requiresApproval).toBe(true);
    expect(d.allowed).toBe(true);
  });
});

describe("resolveAutonomy — allowlist / kill-switch / límites", () => {
  it("fuera de allowlist → máximo A1 (recomendar), nunca ejecuta", () => {
    const d = resolveAutonomy({ action: "create_task" }, ctx, policy({ allowlist: [] }));
    expect(d.grantedLevel).toBe("A1");
    expect(d.allowed).toBe(false);
  });

  it("en allowlist, reversible no-sensible → A3 y ejecuta", () => {
    const d = resolveAutonomy({ action: "create_task", risk: "low" }, ctx, policy({ allowlist: ["create_task"] }));
    expect(d.grantedLevel).toBe("A3");
    expect(d.allowed).toBe(true);
    expect(d.requiresApproval).toBe(false);
  });

  it("kill-switch → todo A0, nada ejecuta", () => {
    const d = resolveAutonomy({ action: "create_task" }, ctx, policy({ killSwitch: true, allowlist: ["create_task"] }));
    expect(d.grantedLevel).toBe("A0");
    expect(d.allowed).toBe(false);
  });

  it("importe por encima del límite → requiere aprobación", () => {
    const d = resolveAutonomy({ action: "create_task", risk: "low", amountCents: 5000 }, ctx, policy({ allowlist: ["create_task"], moneyLimitCents: 1000 }));
    expect(d.requiresApproval).toBe(true);
    expect(d.allowed).toBe(false);
  });

  it("volumen por encima del límite → requiere aprobación", () => {
    const d = resolveAutonomy({ action: "create_task", risk: "low", volume: 100 }, ctx, policy({ allowlist: ["create_task"], volumeLimit: 25 }));
    expect(d.requiresApproval).toBe(true);
  });

  it("mergeAutonomyPolicy SANEA config y 'sensitive' NUNCA se relaja (siempre A4)", () => {
    const m = mergeAutonomyPolicy({
      moneyLimitCents: -5 as any,
      volumeLimit: NaN as any,
      allowlist: ["ok", 123 as any],
      ceilingByRisk: { none: "A9" as any, sensitive: "A0" as any } as any
    });
    expect(m.moneyLimitCents).toBe(DEFAULT_AUTONOMY_POLICY.moneyLimitCents);
    expect(m.volumeLimit).toBe(DEFAULT_AUTONOMY_POLICY.volumeLimit);
    expect(m.allowlist).toEqual(["ok"]);
    expect(m.ceilingByRisk.none).toBe(DEFAULT_AUTONOMY_POLICY.ceilingByRisk.none); // "A9" inválido → default
    expect(m.ceilingByRisk.sensitive).toBe("A4"); // no relajable por config
  });

  it("siempre devuelve razones (auditable) y clave de idempotencia determinista", () => {
    const a = { action: "create_task", clientId: "c1", amountCents: 0 };
    const d = resolveAutonomy(a, ctx, policy({ allowlist: ["create_task"] }));
    expect(d.reasons.length).toBeGreaterThan(0);
    expect(d.idempotencyKey).toBe(idempotencyKeyFor(a, ctx));
    expect(idempotencyKeyFor(a, ctx)).toBe("w1:create_task:c1:0:0");
  });
});
