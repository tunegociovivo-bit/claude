/**
 * GET /api/v1/ai/providers — salud/coste/breaker del multimodelo (admin, tenant-scoped).
 * Negativos: flag off→404, no-admin→403. Happy: lista slots con health por env-key + estado
 * del breaker por proveedor; no expone secretos.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, prisma } = vi.hoisted(() => {
  const prismaObj: any = {
    membership: { findFirst: vi.fn() },
    aiProviderBreaker: { findMany: vi.fn(async () => []) }
  };
  return { authenticateMock: vi.fn(), prisma: prismaObj };
});
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
  process.env.AI_RUN_ORCHESTRATOR = "live";
  process.env.AI_MULTIMODEL = "on";
  process.env.ADMIN_GATE = "enforce";
  process.env.ANTHROPIC_API_KEY = "sk-test-anthropic";
  process.env.OPENAI_API_KEY = "sk-test-openai";
  delete process.env.GEMINI_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
  prisma.membership.findFirst.mockResolvedValue({ role: "ADMIN" });
  prisma.aiProviderBreaker.findMany.mockResolvedValue([{ provider: "anthropic", state: "open", failureCount: 5, openedAt: new Date(), lastFailureAt: new Date(), probeOwner: null, probeExpiresAt: null }]);
});
afterEach(() => {
  process.env = { ...ORIG };
});

const call = () => GET(new NextRequest("https://hub.example/api/v1/ai/providers"), { params: {} });

describe("GET /api/v1/ai/providers", () => {
  it("flag off → 404", async () => {
    process.env.AI_RUN_ORCHESTRATOR = "off";
    expect((await call()).status).toBe(404);
  });
  it("no-admin → 403", async () => {
    prisma.membership.findFirst.mockResolvedValue({ role: "MEMBER" });
    expect((await call()).status).toBe(403);
  });
  it("happy: health por env-key, breaker por proveedor, motor live; sin secretos", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.engine).toMatchObject({ live: true, mode: "live", multiModel: true });
    const anthropic = body.providers.find((p: any) => p.provider === "anthropic");
    const openai = body.providers.find((p: any) => p.provider === "openai");
    const gemini = body.providers.find((p: any) => p.provider === "gemini");
    expect(anthropic.healthy).toBe(true); // clave presente
    expect(openai.healthy).toBe(true);
    expect(gemini.healthy).toBe(false); // sin clave
    expect(anthropic.breaker.state).toBe("open"); // fila de breaker refleja el estado
    expect(openai.breaker.state).toBe("closed"); // sin fila → sano por defecto
    expect(anthropic.costPer1kUsd).toBeTruthy();
    // nunca expone la clave, solo si existe
    expect(JSON.stringify(body)).not.toMatch(/sk-test-anthropic|sk-test-openai/);
  });
});
