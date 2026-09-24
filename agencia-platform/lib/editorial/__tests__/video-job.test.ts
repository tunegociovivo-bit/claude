import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ post: vi.fn(), job: vi.fn(), create: vi.fn(), updateMany: vi.fn(), unique: vi.fn(), query: vi.fn(), generate: vi.fn() }));
vi.mock("@/lib/api/handler", () => ({ withApi: (_options: unknown, handler: unknown) => handler }));
vi.mock("@/lib/api/auth", () => ({ ApiError: class extends Error { constructor(public status: number, public code: string, message: string) { super(message); } } }));
vi.mock("@/lib/editorial/generate-video", () => ({ generatePostVideo: mocks.generate }));
vi.mock("@/lib/db/prisma", () => {
  const db = {
    editorialPost: { findFirst: mocks.post },
    backgroundJob: { findFirst: mocks.job, create: mocks.create, updateMany: mocks.updateMany, findUnique: mocks.unique },
    $queryRaw: mocks.query
  };
  return { prisma: { ...db, $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db) } };
});
import { GET, POST } from "@/app/api/v1/editorial/posts/[id]/generate-video/route";
const context = { params: { id: "post" }, api: { workspaceId: "workspace", userId: "user" } };

beforeEach(() => vi.resetAllMocks());
describe("editorial video jobs", () => {
  it("rejects another workspace's post before starting billable generation", async () => {
    mocks.post.mockResolvedValue(null);
    await expect((POST as any)(new Request("https://hub.test", { method: "POST", body: JSON.stringify({ async: true }) }), context)).rejects.toThrow("Publicación no encontrada");
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.post).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "post", workspaceId: "workspace" } }));
  });
  it("returns an existing running job instead of generating a second paid video", async () => {
    mocks.post.mockResolvedValue({ id: "post" });
    mocks.job.mockResolvedValue({ id: "running", status: "RUNNING" });
    const result = await (POST as any)(new Request("https://hub.test", { method: "POST", body: JSON.stringify({ async: true }) }), context);
    expect(result.status).toBe(202);
    expect(await result.json()).toEqual({ jobId: "running", status: "RUNNING" });
    expect(mocks.query).toHaveBeenCalledOnce();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("makes interrupted jobs retryable after the generation deadline", async () => {
    mocks.job.mockResolvedValue({ id: "stale", status: "RUNNING", createdAt: new Date(Date.now() - 61 * 60000) });
    mocks.unique.mockResolvedValue({ id: "stale", status: "FAILED", errorMessage: "Interrumpida" });
    const response = await (GET as any)(new Request("https://hub.test"), context);
    expect((await response.json()).job.status).toBe("FAILED");
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "stale", status: { in: ["PENDING", "RUNNING"] } } }));
  });
});
