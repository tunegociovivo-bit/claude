import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { authenticateAgent, getRecentSepaDiagnostics, recoverRecentSepaApprovals, syncRecentHoldedApprovals } = vi.hoisted(() => ({
  authenticateAgent: vi.fn(),
  getRecentSepaDiagnostics: vi.fn(),
  recoverRecentSepaApprovals: vi.fn(),
  syncRecentHoldedApprovals: vi.fn()
}));

vi.mock("@/lib/facturacion/sepa/agent", () => ({ authenticateAgent }));
vi.mock("@/lib/facturacion/sepa/diagnostics", () => ({ getRecentSepaDiagnostics, recoverRecentSepaApprovals, syncRecentHoldedApprovals }));

import { GET, POST } from "../route";

describe("GET /api/v1/facturacion/agent/diagnostics/sepa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateAgent.mockResolvedValue({ id: "agent-1", workspaceId: "ws-1" });
  });

  it("devuelve el diagnóstico reciente limitado al workspace del agente", async () => {
    getRecentSepaDiagnostics.mockResolvedValue([{ invoiceNumber: "FAC-003056", eligible: false, reasons: ["cliente_sepa_desactivado"] }]);

    const response = await GET(new NextRequest("https://hub.example/api/v1/facturacion/agent/diagnostics/sepa", {
      headers: { authorization: "Bearer local-agent-token" }
    }));

    expect(response.status).toBe(200);
    expect(getRecentSepaDiagnostics).toHaveBeenCalledWith("ws-1", 50);
    expect(await response.json()).toEqual({ items: [{ invoiceNumber: "FAC-003056", eligible: false, reasons: ["cliente_sepa_desactivado"] }] });
  });

  it("no revela datos a un agente no autorizado", async () => {
    authenticateAgent.mockResolvedValue(null);
    const response = await GET(new NextRequest("https://hub.example/api/v1/facturacion/agent/diagnostics/sepa"));
    expect(response.status).toBe(401);
    expect(getRecentSepaDiagnostics).not.toHaveBeenCalled();
  });

  it("recupera solo aprobaciones recientes dentro del workspace del agente", async () => {
    recoverRecentSepaApprovals.mockResolvedValue({ examined: 3, eligible: 2, created: 2, skipped: 0, invalidated: 0, requestIds: ["r1", "r2"] });
    const response = await POST(new NextRequest("https://hub.example/api/v1/facturacion/agent/diagnostics/sepa", {
      method: "POST", headers: { authorization: "Bearer local-agent-token", "content-type": "application/json" },
      body: JSON.stringify({ invoiceNumbers: ["FAC-003055", "FAC-003056"] })
    }));
    expect(response.status).toBe(200);
    expect(recoverRecentSepaApprovals).toHaveBeenCalledWith("ws-1", ["FAC-003055", "FAC-003056"]);
    expect(await response.json()).toMatchObject({ ok: true, created: 2 });
  });

  it("rechaza una recuperación sin números de factura explícitos", async () => {
    const response = await POST(new NextRequest("https://hub.example/api/v1/facturacion/agent/diagnostics/sepa", {
      method: "POST", headers: { authorization: "Bearer local-agent-token", "content-type": "application/json" }, body: "{}"
    }));
    expect(response.status).toBe(400);
    expect(recoverRecentSepaApprovals).not.toHaveBeenCalled();
  });

  it("sincroniza Holded y crea solicitudes solo para facturas importadas en esa ejecución", async () => {
    syncRecentHoldedApprovals.mockResolvedValue({ holded: { created: 2, createdInvoiceIds: ["i1", "i2"] }, approvals: { created: 2 } });
    const response = await POST(new NextRequest("https://hub.example/api/v1/facturacion/agent/diagnostics/sepa", {
      method: "POST", headers: { authorization: "Bearer local-agent-token", "content-type": "application/json" },
      body: JSON.stringify({ action: "sync" })
    }));
    expect(response.status).toBe(200);
    expect(syncRecentHoldedApprovals).toHaveBeenCalledWith("ws-1");
    expect(await response.json()).toMatchObject({ ok: true, approvals: { created: 2 } });
  });
});
