import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authenticateAgent = vi.fn();
const getRecentSepaDiagnostics = vi.fn();

vi.mock("@/lib/facturacion/sepa/agent", () => ({ authenticateAgent }));
vi.mock("@/lib/facturacion/sepa/diagnostics", () => ({ getRecentSepaDiagnostics }));

import { GET } from "../route";

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
});
