import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = vi.hoisted(() => {
  const client: any = {
    mobileAutomationJob: { findMany: vi.fn(), update: vi.fn() },
    mobileAutomationJobEvent: { create: vi.fn(), groupBy: vi.fn() }
  };
  client.$transaction = vi.fn((fn: (tx: any) => unknown) => fn(client));
  return { prisma: client };
});
vi.mock("@/lib/db/prisma", () => ({ prisma }));

import { autoResumeStalledThreads, isStalledThreadJob, resetAutoResumeThrottleForTests, THREAD_AUTO_RESUME_MAX } from "../thread-resume";

const now = new Date("2026-10-04T10:00:00Z");
const job = (over: Record<string, unknown> = {}) => ({
  id: "j1", status: "FAILED", scheduledAt: new Date(now.getTime() - 3_600_000), leaseUntil: null, text: null, lastErrorCode: null, ...over
});

beforeEach(() => {
  vi.clearAllMocks();
  resetAutoResumeThrottleForTests();
  prisma.mobileAutomationJobEvent.groupBy.mockResolvedValue([]);
});

describe("reactivación automática de conversaciones", () => {
  it("considera parados los fallidos, pendientes de comprobar, abandonados y caducados", () => {
    expect(isStalledThreadJob(job(), now, false)).toBe(true);
    expect(isStalledThreadJob(job({ status: "WAITING_USER" }), now, false)).toBe(true);
    expect(isStalledThreadJob(job({ status: "RUNNING", leaseUntil: new Date(now.getTime() - 1) }), now, false)).toBe(true);
    expect(isStalledThreadJob(job({ status: "CANCELLED", lastErrorCode: "expired" }), now, false)).toBe(true);
  });
  it("no toca trabajos activos, rechazados ni intervalos programados", () => {
    expect(isStalledThreadJob(job({ status: "RUNNING", leaseUntil: new Date(now.getTime() + 60_000) }), now, false)).toBe(false);
    expect(isStalledThreadJob(job({ status: "CANCELLED", lastErrorCode: "parent_rejected" }), now, false)).toBe(false);
    expect(isStalledThreadJob(job({ status: "QUEUED", scheduledAt: new Date(now.getTime() + 60_000) }), now, false)).toBe(false);
    expect(isStalledThreadJob(job({ status: "QUEUED", scheduledAt: new Date(now.getTime() + 60_000) }), now, true)).toBe(true);
  });
  it("reactiva un mensaje parado más de 10 minutos y lo registra", async () => {
    prisma.mobileAutomationJob.findMany.mockResolvedValue([job()]);
    expect(await autoResumeStalledThreads("w", now)).toBe(1);
    const update = prisma.mobileAutomationJob.update.mock.calls[0][0];
    expect(update.where.id).toBe("j1");
    expect(update.data).toMatchObject({ status: "QUEUED", attempts: 0, scheduledAt: now });
    expect(prisma.mobileAutomationJobEvent.create.mock.calls[0][0].data).toMatchObject({ event: "THREAD_AUTO_RESUMED", actorType: "SYSTEM" });
    const where = prisma.mobileAutomationJob.findMany.mock.calls[0][0].where;
    expect(where.updatedAt.lte.getTime()).toBe(now.getTime() - 10 * 60 * 1000);
  });
  it("deja de insistir tras el máximo de reactivaciones", async () => {
    prisma.mobileAutomationJob.findMany.mockResolvedValue([job()]);
    prisma.mobileAutomationJobEvent.groupBy.mockResolvedValue([{ jobId: "j1", _count: { _all: THREAD_AUTO_RESUME_MAX } }]);
    expect(await autoResumeStalledThreads("w", now)).toBe(0);
    expect(prisma.mobileAutomationJob.update).not.toHaveBeenCalled();
  });
  it("se ejecuta como mucho una vez por minuto", async () => {
    prisma.mobileAutomationJob.findMany.mockResolvedValue([]);
    await autoResumeStalledThreads("w", now);
    await autoResumeStalledThreads("w", new Date(now.getTime() + 30_000));
    expect(prisma.mobileAutomationJob.findMany).toHaveBeenCalledTimes(1);
  });
});
