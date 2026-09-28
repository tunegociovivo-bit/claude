import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { prisma } = vi.hoisted(() => {
  const client: any = {
    mobileAutomationJob: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    mobileAutomationJobEvent: { create: vi.fn() }
  };
  client.$transaction = vi.fn((fn: (tx: any) => unknown) => fn(client));
  return { prisma: client };
});
vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/mobile/automation-access", () => ({ loadMobileAutomationAccess: vi.fn() }));
vi.mock("@/lib/api/auth", async (original) => ({
  ...await original<typeof import("@/lib/api/auth")>(),
  authenticate: async () => ({ workspaceId: "w", userId: "u", scopes: new Set(["*"]) })
}));
vi.mock("@/lib/api/rate-limit", () => ({ rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 }) }));
import { POST as checkpoint } from "../jobs/[id]/checkpoint/route";
import { POST as resume } from "../threads/resume/route";

const session = "11111111-1111-4111-8111-111111111111";
const threadId = "22222222-2222-4222-8222-222222222222";
const message = { kind: "comment_thread", version: 1, threadId, order: 1, total: 2,
  postUrl: "https://www.facebook.com/post/1", guide: "g", author: "A", mode: "comment",
  replyToOrder: null, replyToAuthor: null, replyToText: null, parentJobId: null, previousJobId: null,
  text: "Mensaje aprobado", outcome: "pending", detail: null };
const running = () => ({ id: "j", status: "RUNNING", workspaceId: "w", action: "POST_THREAD_MESSAGE", leaseOwner: session,
  leaseUntil: new Date(Date.now() + 120_000), text: JSON.stringify(message), deviceSerial: "usb" });
const request = (body: unknown) => new NextRequest("https://hub.example/api/v1/mobile/automations/jobs/j/checkpoint", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
});
beforeEach(() => {
  vi.clearAllMocks();
  prisma.mobileAutomationJob.findFirst.mockResolvedValue(running());
  prisma.mobileAutomationJob.updateMany.mockResolvedValue({ count: 1 });
});
describe("recuperación segura de conversaciones", () => {
  it("guarda la intención condicionada al propietario, vigencia y texto anterior", async () => {
    const response = await checkpoint(request({ executorSessionId: session, sendIntent: true }), { params: { id: "j" } });
    expect(response.status).toBe(200);
    const update = prisma.mobileAutomationJob.updateMany.mock.calls[0][0];
    expect(update.where).toMatchObject({ workspaceId: "w", leaseOwner: session, text: JSON.stringify(message), leaseUntil: { gt: expect.any(Date) } });
    expect(JSON.parse(update.data.text).outcome).toBe("review");
  });
  it("rechaza una segunda intención de envío", async () => {
    prisma.mobileAutomationJob.findFirst.mockResolvedValue({ ...running(), text: JSON.stringify({ ...message, outcome: "review" }) });
    expect((await checkpoint(request({ executorSessionId: session, sendIntent: true }), { params: { id: "j" } })).status).toBe(409);
    expect(prisma.mobileAutomationJob.updateMany).not.toHaveBeenCalled();
  });
  it("un latido no revive una ejecución cuyo permiso ha caducado", async () => {
    prisma.mobileAutomationJob.findFirst.mockResolvedValue({ ...running(), leaseUntil: new Date(0) });
    expect((await checkpoint(request({ executorSessionId: session }), { params: { id: "j" } })).status).toBe(409);
  });
  it("reactivar no interrumpe un trabajo activo ni aprueba borradores", async () => {
    prisma.mobileAutomationJob.findMany.mockResolvedValue([
      running(), { ...running(), id: "draft", status: "PENDING_APPROVAL" },
      { ...running(), id: "stale", leaseUntil: new Date(0) }
    ]);
    expect((await resume(request({ threadId }), { params: {} })).status).toBe(200);
    expect(prisma.mobileAutomationJob.update).toHaveBeenCalledTimes(1);
    expect(prisma.mobileAutomationJob.update.mock.calls[0][0].where.id).toBe("stale");
  });
});
