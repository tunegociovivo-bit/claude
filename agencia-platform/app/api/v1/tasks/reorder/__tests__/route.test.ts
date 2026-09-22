import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { db } = vi.hoisted(() => ({ db: { task: { findMany: vi.fn(), updateMany: vi.fn() }, taskProject: { updateMany: vi.fn() }, $transaction: vi.fn(async (ops) => Promise.all(ops)) } }));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/api/handler", () => ({ withApi: (_options: unknown, handler: any) => (request: unknown) => handler(request, { api: { workspaceId: "w" } }) }));
import { POST } from "../route";
beforeEach(() => { vi.clearAllMocks(); db.task.findMany.mockResolvedValue([{ id: "shared", projectId: "general" }, { id: "own", projectId: "aitor" }]); });
it("reorders shared tasks only in the recipient project", async () => {
  await POST(new NextRequest("https://hub.example/api/v1/tasks/reorder", { method: "POST", body: JSON.stringify({ projectId: "aitor", items: [{ id: "shared", order: 2, status: "new" }, { id: "own", order: 3 }] }) }), { params: {} });
  expect(db.taskProject.updateMany).toHaveBeenCalledWith({ where: { taskId: "shared", projectId: "aitor" }, data: { order: 2, status: "new" } });
  expect(db.task.updateMany).toHaveBeenCalledTimes(1);
  expect(db.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "own", workspaceId: "w", deletedAt: null }, data: { order: 3 } }));
});
