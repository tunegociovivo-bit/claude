/**
 * PATCH /api/v1/leads/searches/[id] — control pausar/reanudar/cancelar. Valida acción,
 * aislamiento por workspace (workspaceId del solicitante), 404 y estado persistido.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, prisma } = vi.hoisted(() => {
  const rows: any[] = [];
  const prismaObj: any = {
    _rows: rows,
    leadSearch: {
      findFirst: vi.fn(async ({ where }: any) => rows.find((r) => r.id === where.id && r.workspaceId === where.workspaceId) ?? null),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const r = rows.find((x) => x.id === where.id && x.workspaceId === where.workspaceId && (where.status === undefined || x.status === where.status));
        if (!r) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      })
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

import { PATCH } from "../route";

beforeEach(() => {
  vi.clearAllMocks();
  prisma._rows.length = 0;
  prisma._rows.push({ id: "s1", workspaceId: "w1", status: "RUNNING", controlSignal: null });
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
});

const call = (id: string, body: any) =>
  PATCH(new NextRequest(`https://hub.example/api/v1/leads/searches/${id}`, { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), { params: { id } });

describe("PATCH searches/[id] control", () => {
  it("acción inválida → 400", async () => {
    expect((await call("s1", { action: "explode" })).status).toBe(400);
  });
  it("pausar RUNNING → 200 status PAUSING + señal persistida", async () => {
    const res = await call("s1", { action: "pause" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "PAUSING", changed: true });
    expect(prisma._rows[0].controlSignal).toBe("pause");
  });
  it("otro workspace no puede controlar la búsqueda → 404", async () => {
    authenticateMock.mockResolvedValue({ workspaceId: "attacker", userId: "u2", scopes: new Set(["*"]) });
    const res = await call("s1", { action: "cancel" });
    expect(res.status).toBe(404);
    expect(prisma._rows[0].status).toBe("RUNNING"); // intacta
  });
  it("id inexistente → 404", async () => {
    expect((await call("nope", { action: "pause" })).status).toBe(404);
  });
  it("idempotente: cancelar ya-cancelada → 200 changed:false", async () => {
    prisma._rows[0].status = "CANCELLED";
    const res = await call("s1", { action: "cancel" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, changed: false, status: "CANCELLED" });
  });
});
