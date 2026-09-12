import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma, tx } = vi.hoisted(() => {
  const transaction: any = {
    mobileAutomationPolicy: { findUnique: vi.fn() },
    mobileAutomationJob: {
      count: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn()
    },
    mobileAutomationJobEvent: { create: vi.fn() }
  };
  return {
    tx: transaction,
    prisma: { $transaction: vi.fn(async (callback: (client: typeof transaction) => unknown) => callback(transaction)) }
  };
});

vi.mock("@/lib/db/prisma", () => ({ prisma }));

import {
  claimNextMobileAutomationJob,
  reportMobileAutomationResult
} from "@/lib/mobile/automation-jobs";

const now = new Date("2026-09-12T12:00:00.000Z");
const candidate = {
  id: "job-1",
  workspaceId: "w1",
  deviceSerial: "usb-1",
  status: "QUEUED",
  scheduledAt: new Date("2026-09-12T11:00:00.000Z"),
  createdAt: new Date("2026-09-12T10:00:00.000Z"),
  expiresAt: null,
  attempts: 0,
  maxAttempts: 3
};

beforeEach(() => {
  vi.clearAllMocks();
  tx.mobileAutomationPolicy.findUnique.mockResolvedValue({
    enabled: true,
    maxDailyPerDevice: 20,
    minIntervalSeconds: 60,
    allowedStartHour: 0,
    allowedEndHour: 0,
    timezone: "Europe/Madrid"
  });
  tx.mobileAutomationJob.count.mockResolvedValue(0);
  tx.mobileAutomationJob.findFirst.mockResolvedValue(null);
  tx.mobileAutomationJob.findMany.mockResolvedValue([candidate]);
  tx.mobileAutomationJob.updateMany.mockResolvedValue({ count: 1 });
  tx.mobileAutomationJobEvent.create.mockResolvedValue({});
});

describe("mobile automation job leases", () => {
  it("atomically claims a queued job for one browser session", async () => {
    const result = await claimNextMobileAutomationJob({
      workspaceId: "w1",
      deviceSerial: "usb-1",
      executorSessionId: "browser-1",
      now
    });

    expect(result).toMatchObject({ id: "job-1", status: "RUNNING", leaseOwner: "browser-1" });
    expect(tx.mobileAutomationJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "job-1", workspaceId: "w1" }),
      data: expect.objectContaining({ status: "RUNNING", attempts: { increment: 1 } })
    }));
    expect(tx.mobileAutomationJobEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ jobId: "job-1", event: "CLAIMED", actorId: "browser-1" })
    });
  });

  it("returns no work when another tab wins the conditional update", async () => {
    tx.mobileAutomationJob.updateMany.mockResolvedValue({ count: 0 });
    const result = await claimNextMobileAutomationJob({
      workspaceId: "w1",
      deviceSerial: "usb-1",
      executorSessionId: "browser-2",
      now
    });
    expect(result).toBeNull();
    expect(tx.mobileAutomationJobEvent.create).not.toHaveBeenCalled();
  });

  it("enforces the persistent daily limit before reading the queue", async () => {
    tx.mobileAutomationJob.count.mockResolvedValue(20);
    const result = await claimNextMobileAutomationJob({
      workspaceId: "w1",
      deviceSerial: "usb-1",
      executorSessionId: "browser-1",
      now
    });
    expect(result).toBeNull();
    expect(tx.mobileAutomationJob.findMany).not.toHaveBeenCalled();
  });
});

describe("mobile automation result reporting", () => {
  it("moves a prepared job to human confirmation and releases its lease", async () => {
    tx.mobileAutomationJob.findFirst.mockResolvedValue({
      ...candidate,
      status: "RUNNING",
      leaseOwner: "browser-1",
      attempts: 1
    });
    tx.mobileAutomationJob.update.mockResolvedValue({ id: "job-1", status: "WAITING_USER" });

    const result = await reportMobileAutomationResult({
      workspaceId: "w1",
      jobId: "job-1",
      executorSessionId: "browser-1",
      outcome: "PREPARED",
      now
    });

    expect(result).toMatchObject({ status: "WAITING_USER" });
    expect(tx.mobileAutomationJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({ status: "WAITING_USER", leaseOwner: null, preparedAt: now })
    });
  });

  it("rejects a stale browser that no longer owns the lease", async () => {
    tx.mobileAutomationJob.findFirst.mockResolvedValue({
      ...candidate,
      status: "RUNNING",
      leaseOwner: "browser-new",
      attempts: 1
    });

    await expect(reportMobileAutomationResult({
      workspaceId: "w1",
      jobId: "job-1",
      executorSessionId: "browser-old",
      outcome: "PREPARED",
      now
    })).rejects.toMatchObject({ status: 409, code: "lease_lost" });
  });
});
