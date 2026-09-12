import type { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";

const DEFAULT_POLICY = {
  enabled: true,
  maxDailyPerDevice: 20,
  minIntervalSeconds: 60,
  allowedStartHour: 7,
  allowedEndHour: 23,
  timezone: "Europe/Madrid"
};

function localHour(date: Date, timezone: string): number {
  try {
    const hour = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date).find((part) => part.type === "hour")?.value;
    return Number(hour ?? date.getUTCHours());
  } catch {
    return date.getUTCHours();
  }
}

function insideAllowedHours(hour: number, start: number, end: number): boolean {
  if (start === end) return true;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export async function claimNextMobileAutomationJob(input: {
  workspaceId: string;
  deviceSerial: string;
  executorSessionId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const storedPolicy = await tx.mobileAutomationPolicy.findUnique({
      where: { workspaceId: input.workspaceId }
    });
    const policy = storedPolicy ?? DEFAULT_POLICY;
    if (!policy.enabled) return null;
    if (!insideAllowedHours(
      localHour(now, policy.timezone),
      policy.allowedStartHour,
      policy.allowedEndHour
    )) return null;

    const preparedSince = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const preparedCount = await tx.mobileAutomationJob.count({
      where: {
        workspaceId: input.workspaceId,
        deviceSerial: input.deviceSerial,
        preparedAt: { gte: preparedSince }
      }
    });
    if (preparedCount >= policy.maxDailyPerDevice) return null;

    const lastPrepared = await tx.mobileAutomationJob.findFirst({
      where: {
        workspaceId: input.workspaceId,
        deviceSerial: input.deviceSerial,
        preparedAt: { not: null }
      },
      orderBy: { preparedAt: "desc" },
      select: { preparedAt: true }
    });
    if (
      lastPrepared?.preparedAt
      && now.getTime() - lastPrepared.preparedAt.getTime() < policy.minIntervalSeconds * 1000
    ) return null;

    const candidates = await tx.mobileAutomationJob.findMany({
      where: {
        workspaceId: input.workspaceId,
        deviceSerial: input.deviceSerial,
        scheduledAt: { lte: now },
        OR: [
          { status: "QUEUED" },
          { status: "RUNNING", leaseUntil: { lt: now } }
        ]
      },
      orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
      take: 5
    });

    for (const candidate of candidates) {
      if (candidate.expiresAt && candidate.expiresAt <= now) {
        await tx.mobileAutomationJob.update({
          where: { id: candidate.id },
          data: { status: "CANCELLED", lastErrorCode: "expired", lastError: "El trabajo caducó antes de ejecutarse" }
        });
        await tx.mobileAutomationJobEvent.create({
          data: {
            workspaceId: input.workspaceId,
            jobId: candidate.id,
            event: "EXPIRED",
            actorType: "SYSTEM"
          }
        });
        continue;
      }
      const leaseUntil = new Date(now.getTime() + 60_000);
      const claimed = await tx.mobileAutomationJob.updateMany({
        where: {
          id: candidate.id,
          workspaceId: input.workspaceId,
          OR: [
            { status: "QUEUED" },
            { status: "RUNNING", leaseUntil: { lt: now } }
          ]
        },
        data: {
          status: "RUNNING",
          leaseOwner: input.executorSessionId,
          leaseUntil,
          attempts: { increment: 1 },
          lastError: null,
          lastErrorCode: null
        }
      });
      if (claimed.count !== 1) continue;
      await tx.mobileAutomationJobEvent.create({
        data: {
          workspaceId: input.workspaceId,
          jobId: candidate.id,
          event: "CLAIMED",
          actorType: "BROWSER",
          actorId: input.executorSessionId,
          metadata: { leaseUntil: leaseUntil.toISOString() }
        }
      });
      return { ...candidate, status: "RUNNING", leaseOwner: input.executorSessionId, leaseUntil };
    }
    return null;
  }, { isolationLevel: "Serializable" });
}

export async function reportMobileAutomationResult(input: {
  workspaceId: string;
  jobId: string;
  executorSessionId: string;
  outcome: "PREPARED" | "FAILED";
  errorCode?: string;
  error?: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const job = await tx.mobileAutomationJob.findFirst({
      where: { id: input.jobId, workspaceId: input.workspaceId }
    });
    if (!job) throw new ApiError(404, "job_not_found", "El trabajo ya no existe");
    if (job.status !== "RUNNING" || job.leaseOwner !== input.executorSessionId) {
      throw new ApiError(409, "lease_lost", "Esta pestaña ya no posee el trabajo");
    }

    if (input.outcome === "PREPARED") {
      const updated = await tx.mobileAutomationJob.update({
        where: { id: job.id },
        data: {
          status: "WAITING_USER",
          preparedAt: now,
          leaseOwner: null,
          leaseUntil: null,
          lastError: null,
          lastErrorCode: null
        }
      });
      await tx.mobileAutomationJobEvent.create({
        data: {
          workspaceId: input.workspaceId,
          jobId: job.id,
          event: "PREPARED",
          actorType: "BROWSER",
          actorId: input.executorSessionId
        }
      });
      return updated;
    }

    const canRetry = job.attempts < job.maxAttempts;
    const retryDelay = Math.min(300, 15 * 2 ** Math.max(0, job.attempts - 1));
    const updated = await tx.mobileAutomationJob.update({
      where: { id: job.id },
      data: {
        status: canRetry ? "QUEUED" : "FAILED",
        scheduledAt: canRetry ? new Date(now.getTime() + retryDelay * 1000) : job.scheduledAt,
        leaseOwner: null,
        leaseUntil: null,
        lastErrorCode: input.errorCode?.slice(0, 120) || "execution_failed",
        lastError: input.error?.slice(0, 1000) || "No se pudo preparar la acción"
      }
    });
    await tx.mobileAutomationJobEvent.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: job.id,
        event: canRetry ? "RETRY_SCHEDULED" : "FAILED",
        actorType: "BROWSER",
        actorId: input.executorSessionId,
        metadata: { attempt: job.attempts }
      }
    });
    return updated;
  }, { isolationLevel: "Serializable" });
}

export type MobileAutomationTransaction = Prisma.TransactionClient;

