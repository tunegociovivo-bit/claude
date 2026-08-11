/**
 * Contrato FASE 2 · objetivo 5 — compositor sidebar-bootstrap.
 * Verifica que agrega las 6 fuentes y replica el filtro de permisos de projects.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { prisma } = vi.hoisted(() => ({
  prisma: {
    workspace: { findUnique: vi.fn() },
    membership: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
    project: { findMany: vi.fn() },
    client: { findMany: vi.fn() },
    aiUsage: { findMany: vi.fn() }
  }
}));
vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/features", () => ({ effectiveFeatures: (_role: string, _f: any) => ["tareas", "gmb"] }));
vi.mock("@/lib/platforms", () => ({
  platformsVisibleTo: () => [{ key: "reviews", effectiveLabel: "Reseñas", href: "/reviews", icon: { displayName: "Star" } }]
}));

import { getSidebarBootstrap } from "../bootstrap";

beforeEach(() => {
  vi.clearAllMocks();
  prisma.workspace.findUnique.mockResolvedValue({ id: "w1", name: "WS", slug: "ws", logo: null, settings: {} });
  prisma.user.findUnique.mockResolvedValue({ id: "u1", name: "U", email: "u@x", image: null });
  prisma.project.findMany.mockResolvedValue([{ id: "p1", name: "P1" }]);
  prisma.client.findMany.mockResolvedValue([{ id: "c1", name: "C1" }]);
  prisma.aiUsage.findMany.mockResolvedValue([
    { projectId: "p1", costMicros: 100, feature: "reviews_generate" },
    { projectId: null, costMicros: 50, feature: "leads_opener" }
  ]);
});

describe("getSidebarBootstrap", () => {
  it("agrega las 6 fuentes con la forma esperada", async () => {
    prisma.membership.findFirst.mockResolvedValue({ role: "ADMIN", features: null });
    const d = await getSidebarBootstrap("w1", "u1");
    expect(d.workspace).toEqual({ id: "w1", name: "WS", slug: "ws", logo: null });
    expect(d.me.role).toBe("ADMIN");
    expect(d.me.features).toContain("gmb");
    expect(d.platforms.items[0].key).toBe("reviews");
    expect(d.projects.items).toHaveLength(1);
    expect(d.clients.items).toHaveLength(1);
    // usage: proyecto p1=100 (reviews) y plataforma reviews=100, nv_leads=50
    expect(d.usage.projects).toEqual([{ id: "p1", micros: 100 }]);
    expect(d.usage.maxMicros).toBe(100);
  });

  it("ADMIN → sin filtro OR de permisos en projects", async () => {
    prisma.membership.findFirst.mockResolvedValue({ role: "ADMIN", features: null });
    await getSidebarBootstrap("w1", "u1");
    const where = prisma.project.findMany.mock.calls[0][0].where;
    expect(where.OR).toBeUndefined();
    expect(where).toMatchObject({ workspaceId: "w1", archived: false, deletedAt: null });
  });

  it("MIEMBRO → aplica el filtro OR (miembro del proyecto o proyecto abierto)", async () => {
    prisma.membership.findFirst.mockResolvedValue({ role: "MEMBER", features: null });
    await getSidebarBootstrap("w1", "u1");
    const where = prisma.project.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ members: { some: { userId: "u1" } } }, { members: { none: {} } }]);
  });

  it("sin userId (API key) → me.user null y projects sin filtro de usuario", async () => {
    const d = await getSidebarBootstrap("w1", null);
    expect(d.me.user).toBeNull();
    expect(prisma.membership.findFirst).not.toHaveBeenCalled();
    expect(prisma.project.findMany.mock.calls[0][0].where.OR).toBeUndefined();
  });
});
