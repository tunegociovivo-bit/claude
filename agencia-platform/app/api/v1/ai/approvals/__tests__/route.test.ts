/**
 * G6 — endpoints de aprobaciones: flag off→404, no-admin→403, validación estricta
 * (comodín/TTL/caps), concesión + auditoría inmutable, revocación idempotente, tenant.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, prisma } = vi.hoisted(() => {
  const approvals: any[] = [];
  const events: any[] = [];
  const prismaObj: any = {
    _approvals: approvals,
    _events: events,
    membership: { findFirst: vi.fn() },
    aiApproval: {
      findMany: vi.fn(async ({ where }: any) => approvals.filter((a) => a.workspaceId === where.workspaceId)),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `ap${approvals.length + 1}`, revokedAt: null, ...data };
        approvals.push(row);
        return { ...row };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = approvals.find((a) => a.id === where.id && a.workspaceId === where.workspaceId && (where.revokedAt === undefined || a.revokedAt === where.revokedAt));
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      })
    },
    aiApprovalEvent: {
      create: vi.fn(async ({ data }: any) => {
        events.push(data);
        return { ...data };
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

import { POST, GET } from "../route";
import { DELETE } from "../[id]/route";

const ORIG = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  prisma._approvals.length = 0;
  prisma._events.length = 0;
  process.env.AI_RUN_ORCHESTRATOR = "on";
  process.env.ADMIN_GATE = "enforce";
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
  prisma.membership.findFirst.mockResolvedValue({ role: "ADMIN" });
});
afterEach(() => {
  process.env = { ...ORIG };
});

const future = () => new Date(Date.now() + 86400000).toISOString();
const grant = (body: any) => POST(new NextRequest("https://h/api/v1/ai/approvals", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), { params: {} });
const revoke = (id: string) => DELETE(new NextRequest(`https://h/api/v1/ai/approvals/${id}`, { method: "DELETE", body: "{}", headers: { "content-type": "application/json" } }), { params: { id } });

describe("POST /api/v1/ai/approvals", () => {
  it("flag off → 404", async () => {
    process.env.AI_RUN_ORCHESTRATOR = "off";
    expect((await grant({ action: "x", reason: "r", expiresAt: future() })).status).toBe(404);
    expect(prisma.aiApproval.create).not.toHaveBeenCalled();
  });
  it("no-admin → 403", async () => {
    prisma.membership.findFirst.mockResolvedValue({ role: "MEMBER" });
    expect((await grant({ action: "x", reason: "r", expiresAt: future() })).status).toBe(403);
  });
  it("valida: comodín total, sin TTL, sin motivo → 400", async () => {
    expect((await grant({ action: "*", reason: "r", expiresAt: future() })).status).toBe(400);
    expect((await grant({ action: "x", reason: "r" })).status).toBe(400); // sin TTL
    expect((await grant({ action: "x", expiresAt: future() })).status).toBe(400); // sin motivo
  });
  it("sensible con scope amplio → 400; específico → 201 + auditoría", async () => {
    expect((await grant({ action: "send_whatsapp_message", sensitive: true, scope: "*", reason: "r", expiresAt: future(), maxAmountCents: 1000 })).status).toBe(400);
    const res = await grant({ action: "send_whatsapp_message", sensitive: true, scope: "c1", reason: "campaña", expiresAt: future(), maxAmountCents: 1000 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.granted).toBe(true);
    // auditoría inmutable registrada con actor + motivo
    expect(prisma._events.some((e: any) => e.event === "granted" && e.actorId === "u1" && e.reason === "campaña")).toBe(true);
    // tenant en la fila
    expect(prisma._approvals[0].workspaceId).toBe("w1");
  });
});

describe("DELETE /api/v1/ai/approvals/[id]", () => {
  it("revoca + auditoría; revocar de nuevo → 404 (idempotente)", async () => {
    await grant({ action: "send_whatsapp_message", scope: "c1", reason: "x", expiresAt: future() });
    const id = prisma._approvals[0].id;
    const r1 = await revoke(id);
    expect(r1.status).toBe(200);
    expect(prisma._events.some((e: any) => e.event === "revoked" && e.actorId === "u1")).toBe(true);
    const r2 = await revoke(id);
    expect(r2.status).toBe(404); // ya revocada
  });
  it("revocar id de otro workspace → 404 (tenant)", async () => {
    prisma._approvals.push({ id: "apX", workspaceId: "w2", revokedAt: null });
    expect((await revoke("apX")).status).toBe(404);
  });
});
