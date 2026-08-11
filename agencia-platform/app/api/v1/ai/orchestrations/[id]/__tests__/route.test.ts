/**
 * Slice 2c — GET panel de orquestación: flag, tenant, not_found, y que NO expone
 * el texto crudo de error (solo diagnóstico).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, prisma } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  prisma: {
    aiOrchestration: { findFirst: vi.fn() },
    aiRunStep: { findMany: vi.fn() }
  }
}));
vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/api/auth", async (importActual) => {
  const actual = (await importActual()) as any;
  return { ...actual, authenticate: authenticateMock };
});
vi.mock("@/lib/api/rate-limit", () => ({ rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 }) }));

import { GET } from "../route";

const ORIG = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_RUN_ORCHESTRATOR = "on";
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
  prisma.aiOrchestration.findFirst.mockResolvedValue(null);
  prisma.aiRunStep.findMany.mockResolvedValue([]);
});
afterEach(() => {
  process.env = { ...ORIG };
});

const call = (id: string) => GET(new NextRequest(`https://hub.example/api/v1/ai/orchestrations/${id}`, { method: "GET" }), { params: { id } });

describe("GET /api/v1/ai/orchestrations/[id]", () => {
  it("flag off → 404", async () => {
    process.env.AI_RUN_ORCHESTRATOR = "off";
    expect((await call("o1")).status).toBe(404);
  });

  it("no encontrada (o de otro workspace) → 404, con workspaceId en el where", async () => {
    const res = await call("o1");
    expect(res.status).toBe(404);
    expect(prisma.aiOrchestration.findFirst.mock.calls[0][0].where).toMatchObject({ id: "o1", workspaceId: "w1" });
  });

  it("devuelve panel sin el error crudo (solo diagnóstico) y con coste/proveedores", async () => {
    prisma.aiOrchestration.findFirst.mockResolvedValue({
      id: "o1",
      taskId: "t1",
      state: "waiting_backoff",
      mode: "shadow",
      strategy: "switch_model",
      plan: null,
      usage: { attempts: 2, elapsedMs: 5000, tokens: 1200, costUsd: 0.05 },
      decision: null
    });
    prisma.aiRunStep.findMany.mockResolvedValue([
      { seq: 0, phase: "executing", strategy: "retry_same", provider: "anthropic", model: "claude-opus-4-7", ok: false, diagnosis: "transient", costUsd: 0.02, tokensIn: 100, tokensOut: 50, fingerprint: "fp", evidence: null, createdAt: new Date(), error: "SECRETO ab12: contraseña 1234" }
    ]);
    const body = await (await call("o1")).json();
    expect(body.state).toBe("waiting_backoff");
    expect(body.stateLabel).toBeTruthy();
    expect(body.providersUsed).toContain("anthropic");
    expect(body.modelsUsed).toContain("claude-opus-4-7");
    expect(body.cost.realUsd).toBeCloseTo(0.02, 4);
    // el texto crudo de error NUNCA se serializa
    expect(JSON.stringify(body)).not.toMatch(/SECRETO|contraseña/);
    expect(body.steps[0].diagnosis).toBe("transient");
    // el select tampoco pide `error`
    const sel = prisma.aiRunStep.findMany.mock.calls[0][0].select;
    expect(sel.error).toBeUndefined();
  });
});
