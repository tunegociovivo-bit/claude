/**
 * GET /api/v1/ai/learning — flag off→404, no-admin→403, y listado tenant-scoped de lo aprendido.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, prisma } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  prisma: { membership: { findFirst: vi.fn() }, aiStrategyMemory: { findMany: vi.fn() } }
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
  process.env.ADMIN_GATE = "enforce";
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
  prisma.membership.findFirst.mockResolvedValue({ role: "ADMIN" });
  prisma.aiStrategyMemory.findMany.mockResolvedValue([
    { taskSignature: "sig1", rootCause: "provider:x", strategyKind: "switch_provider", provider: "anthropic", model: "", successCount: 3, failureCount: 1, score: 0.66, lastOutcome: "success", lastEvidence: { check: "ok" }, lastUsedAt: new Date() }
  ]);
});
afterEach(() => {
  process.env = { ...ORIG };
});

const call = () => GET(new NextRequest("https://h/api/v1/ai/learning", { method: "GET" }), { params: {} });

describe("GET /api/v1/ai/learning", () => {
  it("flag off → 404", async () => {
    process.env.AI_RUN_ORCHESTRATOR = "off";
    expect((await call()).status).toBe(404);
    expect(prisma.aiStrategyMemory.findMany).not.toHaveBeenCalled();
  });
  it("no-admin → 403", async () => {
    prisma.membership.findFirst.mockResolvedValue({ role: "MEMBER" });
    expect((await call()).status).toBe(403);
  });
  it("admin → lista lo aprendido, tenant-scoped, con resumen", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.verifiedSuccesses).toBe(3);
    expect(body.summary.verifiedFailures).toBe(1);
    expect(body.learned[0].strategyKind).toBe("switch_provider");
    // la consulta va scoped por workspace
    expect(prisma.aiStrategyMemory.findMany.mock.calls[0][0].where.workspaceId).toBe("w1");
  });
});
