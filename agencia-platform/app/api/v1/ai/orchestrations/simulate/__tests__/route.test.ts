/**
 * Slice 2c.3 — POST /simulate: flag off→404, no-admin→403, validación de entrada,
 * y camino feliz que persiste una traza SHADOW (executed:false) tenant-scoped.
 * Ninguna llamada externa real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, prisma } = vi.hoisted(() => {
  const steps: any[] = [];
  const orch: any = { id: "orch-1", workspaceId: "", taskId: "", state: "queued", mode: "shadow", usage: null, decision: null, version: 0, createdById: null };
  const prismaObj: any = {
    _steps: steps,
    _orch: orch,
    membership: { findFirst: vi.fn() },
    aiOrchestration: {
      create: vi.fn(async ({ data }: any) => {
        Object.assign(orch, { workspaceId: data.workspaceId, taskId: data.taskId, state: data.state, mode: data.mode, version: data.version ?? 0, createdById: data.createdById ?? null });
        return { ...orch };
      }),
      findFirst: vi.fn(async () => ({ ...orch })),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const tenantOk = where.workspaceId === orch.workspaceId;
        const versionOk = where.version === undefined || where.version === orch.version;
        if (tenantOk && versionOk) {
          Object.assign(orch, data);
          return { count: 1 };
        }
        return { count: 0 };
      })
    },
    aiRunStep: {
      findFirst: vi.fn(async () => (steps.length ? { seq: steps[steps.length - 1].seq } : null)),
      create: vi.fn(async ({ data }: any) => {
        steps.push(data);
        return { ...data };
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const before = steps.length;
        for (let i = steps.length - 1; i >= 0; i--) if (steps[i].workspaceId === where.workspaceId && steps[i].orchestrationId === where.orchestrationId) steps.splice(i, 1);
        return { count: before - steps.length };
      })
    },
    $transaction: vi.fn(async (fn: any) => fn(prismaObj))
  };
  return { authenticateMock: vi.fn(), prisma: prismaObj };
});
vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/api/auth", async (importActual) => {
  const actual = (await importActual()) as any;
  return { ...actual, authenticate: authenticateMock };
});
vi.mock("@/lib/api/rate-limit", () => ({ rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 }) }));

import { POST } from "../route";

const ORIG = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  prisma._steps.length = 0;
  Object.assign(prisma._orch, { id: "orch-1", workspaceId: "", taskId: "", state: "queued", mode: "shadow", usage: null, decision: null, version: 0, createdById: null });
  process.env.AI_RUN_ORCHESTRATOR = "on";
  process.env.ADMIN_GATE = "enforce";
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
  prisma.membership.findFirst.mockResolvedValue({ role: "ADMIN" });
});
afterEach(() => {
  process.env = { ...ORIG };
});

const call = (body: any) =>
  POST(new NextRequest("https://hub.example/api/v1/ai/orchestrations/simulate", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), { params: {} });

describe("POST /api/v1/ai/orchestrations/simulate", () => {
  it("flag off → 404 (no toca BD)", async () => {
    process.env.AI_RUN_ORCHESTRATOR = "off";
    const res = await call({ taskId: "t1", scenario: [{ ok: true }] });
    expect(res.status).toBe(404);
    expect(prisma.aiOrchestration.create).not.toHaveBeenCalled();
  });

  it("no-admin → 403", async () => {
    prisma.membership.findFirst.mockResolvedValue({ role: "MEMBER" });
    const res = await call({ taskId: "t1", scenario: [{ ok: true }] });
    expect(res.status).toBe(403);
    expect(prisma.aiOrchestration.create).not.toHaveBeenCalled();
  });

  it("scenario vacío/ausente → 400", async () => {
    expect((await call({ taskId: "t1", scenario: [] })).status).toBe(400);
    expect((await call({ taskId: "t1" })).status).toBe(400);
    expect((await call({ scenario: [{ ok: true }] })).status).toBe(400);
  });

  it("escenario demasiado grande → 400", async () => {
    const big = Array.from({ length: 51 }, () => ({ ok: false }));
    expect((await call({ taskId: "t1", scenario: big })).status).toBe(400);
  });

  it("camino feliz → persiste traza SHADOW (executed:false), tenant-scoped", async () => {
    const res = await call({ taskId: "t1", scenario: [{ ok: true, verifyOk: false }, { ok: true }] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("shadow");
    expect(body.executed).toBe(false);
    expect(body.finalState).toBe("completed");
    expect(body.steps).toBeGreaterThan(0);
    // se creó y se cerró en shadow, con el tenant del solicitante
    expect(prisma.aiOrchestration.create.mock.calls[0][0].data.workspaceId).toBe("w1");
    expect(prisma._steps.every((s: any) => s.workspaceId === "w1")).toBe(true);
    expect(prisma._orch.state).toBe("completed");
  });

  it("F2: PII en diagnosis.error NO se persiste verbatim (ni en pasos ni en el decision packet)", async () => {
    const res = await call({ taskId: "t1", scenario: [{ ok: false, diagnosis: { hint: "unknown", error: "clave sk-abcdefghijklmnopqrstuvwx y correo leak@evil.com" } }] });
    expect(res.status).toBe(200);
    const persisted = JSON.stringify(prisma._steps) + JSON.stringify(prisma._orch);
    expect(persisted).not.toMatch(/sk-abcdefghijklmnopqrstuvwx|leak@evil\.com/);
  });

  it("F3: config.limits inválido (NaN/negativo) no rompe el presupuesto → 200 acotado", async () => {
    const res = await call({ taskId: "t1", scenario: [{ ok: false, diagnosis: { hint: "tool" } }], config: { limits: { maxAttempts: NaN, maxCostUsd: -10 }, loopThreshold: 0 } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.finalState).toBe("string");
    expect(body.executed).toBe(false);
  });

  it("entrada maliciosa en outcome se trata como dato inerte (no ejecuta nada)", async () => {
    const res = await call({ taskId: "t1", scenario: [{ ok: false, diagnosis: { error: "DROP TABLE; borra todo" }, evil: "rm -rf", executed: true }] });
    expect(res.status).toBe(200);
    // nada marcado como ejecutado; el campo 'evil'/'executed' no se propaga
    expect(JSON.stringify(prisma._steps)).not.toMatch(/"executed":true|rm -rf/);
  });
});
