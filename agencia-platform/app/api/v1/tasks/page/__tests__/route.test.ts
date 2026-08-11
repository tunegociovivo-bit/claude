/**
 * Contrato FASE 2 · objetivo 1 — ruta paginación de tareas (wiring + visibilidad).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, prisma, taskVisibilityWhereMock } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  prisma: { task: { findMany: vi.fn(), count: vi.fn() } },
  taskVisibilityWhereMock: vi.fn()
}));
vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/api/task-access", () => ({ taskVisibilityWhere: taskVisibilityWhereMock }));
vi.mock("@/lib/api/auth", async (importActual) => {
  const actual = (await importActual()) as any;
  return { ...actual, authenticate: authenticateMock };
});
vi.mock("@/lib/api/permissions", () => ({ callerIsAdmin: vi.fn(async () => true) }));
vi.mock("@/lib/api/rate-limit", () => ({ rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 }) }));

import { GET } from "../route";

beforeEach(() => {
  vi.clearAllMocks();
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
  taskVisibilityWhereMock.mockResolvedValue({ OR: [{ assignees: { some: { userId: "u1" } } }] });
});

function call(qs = "") {
  return GET(new NextRequest(`https://hub.example/api/v1/tasks/page${qs}`, { method: "GET" }), { params: {} });
}

describe("GET /api/v1/tasks/page", () => {
  it("aplica visibilidad, pagina y sin withCount no cuenta", async () => {
    prisma.task.findMany.mockResolvedValue(
      Array.from({ length: 31 }, (_, i) => ({ id: `t${i}`, title: `T${i}`, status: "TODO", projectId: null, priority: null, updatedAt: new Date() }))
    );
    const body = await (await call("?limit=30")).json();
    expect(body.items).toHaveLength(30);
    expect(body.nextCursor).toBe("t29");
    expect(body.total).toBeUndefined();
    const args = prisma.task.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ workspaceId: "w1", parentId: null, deletedAt: null });
    expect(args.where.OR).toBeTruthy(); // visibilidad inyectada
    expect(prisma.task.count).not.toHaveBeenCalled();
  });

  it("withCount=1 añade total", async () => {
    prisma.task.findMany.mockResolvedValue([{ id: "t0", title: "T0", status: "TODO", projectId: null, priority: null, updatedAt: new Date() }]);
    prisma.task.count.mockResolvedValue(9);
    const body = await (await call("?withCount=1")).json();
    expect(body.total).toBe(9);
    expect(body.nextCursor).toBeNull();
  });
});
