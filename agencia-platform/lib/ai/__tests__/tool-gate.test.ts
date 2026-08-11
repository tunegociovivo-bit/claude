/**
 * Regresión FASE 1 · Punto 3 — gate server-side de tools IA peligrosas.
 * La decisión de peligro es AUTORÍA DEL SERVIDOR (esta lista), no del modelo.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { toolGateMode, toolDanger, blockedToolResult, DANGEROUS_TOOLS } from "../nv-ia/tool-gate";

const ORIG = { ...process.env };
beforeEach(() => {
  delete process.env.AI_TOOL_GATE;
});
afterEach(() => {
  process.env = { ...ORIG };
});

describe("toolGateMode", () => {
  it("por defecto = enforce (obligatorio)", () => {
    expect(toolGateMode({} as any)).toBe("enforce");
  });
  it("respeta off / log / enforce", () => {
    expect(toolGateMode({ AI_TOOL_GATE: "off" } as any)).toBe("off");
    expect(toolGateMode({ AI_TOOL_GATE: "log" } as any)).toBe("log");
    expect(toolGateMode({ AI_TOOL_GATE: "ENFORCE" } as any)).toBe("enforce");
  });
  it("valor inválido → enforce", () => {
    expect(toolGateMode({ AI_TOOL_GATE: "loose" } as any)).toBe("enforce");
  });
});

describe("toolDanger — dinero / mensajería son peligrosas", () => {
  it.each([
    "send_whatsapp_message",
    "send_whatsapp_voice",
    "stripe_refund_charge",
    "stripe_create_subscription",
    "holded_create_invoice",
    "make_activate_scenario"
  ])("%s → peligrosa", (name) => {
    expect(toolDanger(name, {})).not.toBeNull();
    expect(DANGEROUS_TOOLS[name] ?? "make").toBeTruthy();
  });

  it("tools de solo lectura no son peligrosas", () => {
    expect(toolDanger("get_client_info", {})).toBeNull();
    expect(toolDanger("list_tasks", {})).toBeNull();
  });
});

describe("toolDanger — make_raw_api depende del método", () => {
  it("GET/HEAD/OPTIONS → seguras", () => {
    expect(toolDanger("make_raw_api", { method: "GET" })).toBeNull();
    expect(toolDanger("make_raw_api", { method: "head" })).toBeNull();
  });
  it("POST/PATCH/PUT/DELETE → peligrosas", () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      expect(toolDanger("make_raw_api", { method })).not.toBeNull();
    }
  });
  it("sin método → asume GET (seguro)", () => {
    expect(toolDanger("make_raw_api", {})).toBeNull();
  });
});

describe("blockedToolResult", () => {
  it("devuelve error requires_human_approval con la tool y la razón", () => {
    const r = blockedToolResult("stripe_refund_charge", "dinero");
    expect(r.error).toBe("requires_human_approval");
    expect(r.tool).toBe("stripe_refund_charge");
    expect(r.message).toMatch(/aprob/i);
  });
});
