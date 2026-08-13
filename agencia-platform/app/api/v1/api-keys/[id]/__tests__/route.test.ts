/**
 * DELETE /api/v1/api-keys/[id] — revocación real (admin, tenant-scoped, idempotente).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, prisma } = vi.hoisted(() => {
  const keys: any[] = [];
  const prismaObj: any = {
    _keys: keys,
    membership: { findFirst: vi.fn() },
    apiKey: {
      updateMany: vi.fn(async ({ where, data }: any) => {
        const k = keys.find((x) => x.id === where.id && x.workspaceId === where.workspaceId && (where.revokedAt === null ? x.revokedAt == null : true));
        if (!k) return { count: 0 };
        Object.assign(k, data);
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

import { DELETE } from "../route";

const ORIG = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  prisma._keys.length = 0;
  prisma._keys.push({ id: "k1", workspaceId: "w1", revokedAt: null }, { id: "k2", workspaceId: "other", revokedAt: null });
  process.env.ADMIN_GATE = "enforce";
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
  prisma.membership.findFirst.mockResolvedValue({ role: "ADMIN" });
});
afterEach(() => {
  process.env = { ...ORIG };
});

const call = (id: string) => DELETE(new NextRequest(`https://hub.example/api/v1/api-keys/${id}`, { method: "DELETE" }), { params: { id } });

describe("DELETE /api/v1/api-keys/[id]", () => {
  it("no-admin → 403 (no revoca)", async () => {
    prisma.membership.findFirst.mockResolvedValue({ role: "MEMBER" });
    const res = await call("k1");
    expect(res.status).toBe(403);
    expect(prisma._keys[0].revokedAt).toBeNull();
  });
  it("admin revoca su key → 200 + revokedAt fijado", async () => {
    const res = await call("k1");
    expect(res.status).toBe(200);
    expect((await res.json())).toMatchObject({ ok: true, id: "k1", revoked: true });
    expect(prisma._keys[0].revokedAt).toBeInstanceOf(Date);
  });
  it("key de OTRO tenant → 404 (no la toca)", async () => {
    const res = await call("k2");
    expect(res.status).toBe(404);
    expect(prisma._keys[1].revokedAt).toBeNull();
  });
  it("idempotente: revocar dos veces → segunda 404 (no reescribe la fecha)", async () => {
    await call("k1");
    const first = prisma._keys[0].revokedAt;
    const res2 = await call("k1");
    expect(res2.status).toBe(404);
    expect(prisma._keys[0].revokedAt).toBe(first);
  });
  it("id inexistente → 404", async () => {
    expect((await call("nope")).status).toBe(404);
  });
});
