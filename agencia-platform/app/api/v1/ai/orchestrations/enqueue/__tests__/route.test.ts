/**
 * POST /api/v1/ai/orchestrations/enqueue — ENQUEUER LIVE (A0/A1). Negativos:
 * auth (flag off→404, no-admin→403), tenant (workspaceId del body IGNORADO),
 * idempotencia (mismo taskId no duplica), A2/A3→422, verification inválida→422,
 * tope de concurrencia→429; y un CANARY seguro (resumen estructurado) → 201 queued/live.
 * Ninguna llamada externa real: solo persiste el esqueleto queued.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, prisma } = vi.hoisted(() => {
  const rows: any[] = []; // orquestaciones "persistidas" (por workspaceId+taskId)
  const steps: any[] = [];
  let seq = 0;
  const prismaObj: any = {
    _rows: rows,
    _steps: steps,
    membership: { findFirst: vi.fn() },
    aiOrchestration: {
      create: vi.fn(async ({ data }: any) => {
        // Simula @@unique([workspaceId, taskId]) → P2002 en colisión.
        if (rows.some((r) => r.workspaceId === data.workspaceId && r.taskId === data.taskId)) {
          const e: any = new Error("unique"); e.code = "P2002"; throw e;
        }
        const row = { id: `orch-${rows.length + 1}`, ...data };
        rows.push(row);
        return { ...row };
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        const r = rows.find((x) => x.workspaceId === where.workspaceId && x.taskId === where.taskId);
        return r ? { ...r } : null;
      }),
      count: vi.fn(async ({ where }: any) => rows.filter((r) => r.workspaceId === where.workspaceId && where.state.in.includes(r.state) && (where.mode == null || r.mode === where.mode)).length)
    },
    aiRunStep: {
      findFirst: vi.fn(async ({ where }: any) => {
        const own = steps.filter((s) => s.orchestrationId === where.orchestrationId);
        return own.length ? { seq: own[own.length - 1].seq } : null;
      }),
      create: vi.fn(async ({ data }: any) => { steps.push({ ...data, seq: data.seq ?? seq++ }); return { ...data }; })
    }
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
  prisma._rows.length = 0;
  prisma._steps.length = 0;
  process.env.AI_RUN_ORCHESTRATOR = "live";
  process.env.AI_MULTIMODEL = "on";
  process.env.ADMIN_GATE = "enforce";
  delete process.env.AI_ENQUEUE_ACTIVE_CAP;
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
  prisma.membership.findFirst.mockResolvedValue({ role: "ADMIN" });
});
afterEach(() => {
  process.env = { ...ORIG };
});

const SUMMARY = { taskType: "resumen", autonomy: "A1", objective: "Resume el informe trimestral adjunto", verification: { mustCoverKeyPoints: ["beneficio neto", "flujo de caja"] } };
const call = (body: any) =>
  POST(new NextRequest("https://hub.example/api/v1/ai/orchestrations/enqueue", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), { params: {} });

describe("auth / flag", () => {
  it("flag off → 404 (no toca BD)", async () => {
    process.env.AI_RUN_ORCHESTRATOR = "off";
    const res = await call(SUMMARY);
    expect(res.status).toBe(404);
    expect(prisma.aiOrchestration.create).not.toHaveBeenCalled();
  });
  it("no-admin → 403 (no encola)", async () => {
    prisma.membership.findFirst.mockResolvedValue({ role: "MEMBER" });
    const res = await call({ ...SUMMARY, taskId: "t1" });
    expect(res.status).toBe(403);
    expect(prisma.aiOrchestration.create).not.toHaveBeenCalled();
  });
  it("motor en SHADOW (AI_MULTIMODEL off) → 409 engine_shadow (no encola live falso)", async () => {
    process.env.AI_MULTIMODEL = "off";
    const res = await call({ ...SUMMARY, taskId: "t1" });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("engine_shadow");
    expect(prisma.aiOrchestration.create).not.toHaveBeenCalled();
  });
  it("motor en SHADOW (AI_RUN_ORCHESTRATOR=on, no live) → 409 engine_shadow", async () => {
    process.env.AI_RUN_ORCHESTRATOR = "on";
    const res = await call({ ...SUMMARY, taskId: "t1" });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("engine_shadow");
  });
});

describe("tenant scoping", () => {
  it("workspaceId del body se IGNORA → usa api.workspaceId", async () => {
    const res = await call({ ...SUMMARY, taskId: "t1", workspaceId: "attacker-ws" });
    expect(res.status).toBe(201);
    expect(prisma._rows[0].workspaceId).toBe("w1");
    expect(prisma._rows.some((r: any) => r.workspaceId === "attacker-ws")).toBe(false);
  });
});

describe("idempotencia por taskId", () => {
  it("mismo taskId no duplica; devuelve el existente con created:false", async () => {
    const a = await call({ ...SUMMARY, taskId: "dup" });
    expect(a.status).toBe(201);
    const bodyA = await a.json();
    const b = await call({ ...SUMMARY, taskId: "dup", objective: "otro objetivo distinto" });
    expect(b.status).toBe(200);
    const bodyB = await b.json();
    expect(bodyB.created).toBe(false);
    expect(bodyB.id).toBe(bodyA.id);
    expect(prisma._rows.length).toBe(1); // no se creó una segunda fila
    // el plan original NO se pisó
    expect(prisma._rows[0].plan.objective).toBe("Resume el informe trimestral adjunto");
  });
});

describe("A2/A3/A4 → 422 requires_approval (fail-closed)", () => {
  it.each(["A2", "A3", "A4"])("%s no puede encolarse LIVE", async (level) => {
    const res = await call({ ...SUMMARY, taskId: `t-${level}`, autonomy: level });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("requires_approval");
    expect(prisma.aiOrchestration.create).not.toHaveBeenCalled();
  });
  it("autonomy ausente → 400", async () => {
    const { autonomy, ...noAuto } = SUMMARY as any;
    expect((await call({ ...noAuto, taskId: "t1" })).status).toBe(400);
  });
});

describe("validación estricta de taskType + verification", () => {
  it("taskType sin verificador objetivo → 422", async () => {
    const res = await call({ taskId: "t1", autonomy: "A1", taskType: "cosa_rara", objective: "x", verification: {} });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("invalid_verification");
  });
  it("resumen sin mustCoverKeyPoints → 422", async () => {
    const res = await call({ taskId: "t1", autonomy: "A1", taskType: "resumen", objective: "x", verification: {} });
    expect(res.status).toBe(422);
  });
  it("estructurado sin format válido → 422", async () => {
    const res = await call({ taskId: "t1", autonomy: "A0", taskType: "extraccion", objective: "x", verification: { format: "xml" } });
    expect(res.status).toBe(422);
  });
  it("verification con PII (email/clave) → 422 (no se persiste PII en el plan)", async () => {
    const res = await call({ taskId: "t1", autonomy: "A1", taskType: "comentario", objective: "actualiza la nota", verification: { mustReference: ["leak@evil.com"] } });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("invalid_verification");
    expect(prisma.aiOrchestration.create).not.toHaveBeenCalled();
  });
  it("objective ausente → 400; taskId ausente → 400", async () => {
    expect((await call({ ...SUMMARY, taskId: "t1", objective: "" })).status).toBe(400);
    const { objective, ...noObj } = SUMMARY as any;
    expect((await call({ ...noObj, taskId: "t2" })).status).toBe(400);
    expect((await call({ ...SUMMARY })).status).toBe(400); // sin taskId
  });
});

describe("tope de concurrencia por workspace", () => {
  it("supera el cap → 429 (no encola más)", async () => {
    process.env.AI_ENQUEUE_ACTIVE_CAP = "2";
    expect((await call({ ...SUMMARY, taskId: "a" })).status).toBe(201);
    expect((await call({ ...SUMMARY, taskId: "b" })).status).toBe(201);
    const res = await call({ ...SUMMARY, taskId: "c" });
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("too_many_active");
    expect(prisma._rows.length).toBe(2);
  });
  it("reintento idempotente de un taskId existente NO se rechaza aunque esté al tope", async () => {
    process.env.AI_ENQUEUE_ACTIVE_CAP = "1";
    expect((await call({ ...SUMMARY, taskId: "a" })).status).toBe(201); // ocupa el único cupo
    const retry = await call({ ...SUMMARY, taskId: "a" }); // mismo taskId → idempotente
    expect(retry.status).toBe(200);
    expect((await retry.json()).created).toBe(false);
    expect((await call({ ...SUMMARY, taskId: "b" })).status).toBe(429); // uno nuevo sí se frena
  });
});

describe("límites acotados por el techo del canary", () => {
  it("el cliente no puede pedir MÁS que el techo", async () => {
    process.env.AI_CANARY_MAX_ATTEMPTS = "3";
    process.env.AI_CANARY_MAX_COST_USD = "0.05";
    const res = await call({ ...SUMMARY, taskId: "t1", limits: { maxAttempts: 999, maxCostUsd: 100 } });
    expect(res.status).toBe(201);
    const row = prisma._rows[0];
    expect(row.limits.maxAttempts).toBe(3);
    expect(row.limits.maxCostUsd).toBe(0.05);
  });
});

describe("CANARY seguro — resumen estructurado", () => {
  it("→ 201 queued/live/nextRunAt, plan válido, audit step 'enqueued', SIN ejecutar nada", async () => {
    const res = await call({ ...SUMMARY, taskId: "canary-1", autonomy: "A1" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ created: true, mode: "live", state: "queued", autonomy: "A1", taskType: "resumen", verifierType: "summary" });
    expect(body.nextRunAt).toBeTruthy();
    const row = prisma._rows[0];
    expect(row.mode).toBe("live");
    expect(row.state).toBe("queued");
    expect(row.nextRunAt).toBeInstanceOf(Date);
    expect(row.plan.verification.mustCoverKeyPoints).toEqual(["beneficio neto", "flujo de caja"]);
    expect(row.usage).toMatchObject({ attempts: 0 });
    // auditoría: un paso append-only phase "enqueued", sin PII/output crudo
    const enq = prisma._steps.find((s: any) => s.phase === "enqueued");
    expect(enq).toBeTruthy();
    expect(enq.evidence).toMatchObject({ taskType: "resumen", verifierType: "summary", autonomy: "A1" });
  });
  it("PII en objective NO se persiste verbatim en el plan", async () => {
    await call({ ...SUMMARY, taskId: "pii-1", objective: "Resume esto para leak@evil.com con clave sk-abcdefghijklmnopqrstuvwx aquí y cubre beneficio neto y flujo de caja" });
    const persisted = JSON.stringify(prisma._rows) + JSON.stringify(prisma._steps);
    expect(persisted).not.toMatch(/sk-abcdefghijklmnopqrstuvwx|leak@evil\.com/);
  });
});
