import { prisma } from "@/lib/db/prisma";
import { hunterStatusToVerification } from "./email-verification";
import { hunterVerifyEmail } from "./enrich-contacts";

export function nextUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 5));
}

type HunterReservation =
  | { kind: "claimed" }
  | { kind: "cached"; status: string }
  | { kind: "deferred"; retryAt: Date }
  | { kind: "quota"; retryAt: Date }
  | { kind: "busy"; retryAt: Date };

async function reserveHunterDailySlot(opts: {
  workspaceId: string;
  cacheId: string;
  dailyLimit: number;
  now: Date;
}): Promise<HunterReservation> {
  const dayStart = new Date(Date.UTC(opts.now.getUTCFullYear(), opts.now.getUTCMonth(), opts.now.getUTCDate()));
  return prisma.$transaction(async (tx) => {
    const current = await tx.leadEmailVerificationCache.findUnique({ where: { id: opts.cacheId } });
    if (current?.expiresAt && current.expiresAt > opts.now && ["deliverable", "risky", "invalid"].includes(current.status)) {
      return { kind: "cached", status: current.status } as const;
    }
    if (current?.nextVerificationAt && current.nextVerificationAt > opts.now) {
      return { kind: "deferred", retryAt: current.nextVerificationAt } as const;
    }
    if (!current) return { kind: "busy", retryAt: new Date(opts.now.getTime() + 5 * 60_000) } as const;

    // Primero reclamamos este buzón: dos réplicas no gastan dos créditos para
    // la misma dirección. Después incrementamos un contador diario append-only
    // de intentos; los reintentos del mismo email también consumen una unidad.
    const claimed = await tx.leadEmailVerificationCache.updateMany({
      where: {
        id: current.id,
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: opts.now } }],
        AND: [{ OR: [{ nextVerificationAt: null }, { nextVerificationAt: { lte: opts.now } }] }]
      },
      data: {
        status: "processing",
        leaseUntil: new Date(opts.now.getTime() + 2 * 60_000),
        lastError: null
      }
    });
    if (!claimed.count) {
      return { kind: "busy", retryAt: current.leaseUntil ?? new Date(opts.now.getTime() + 5 * 60_000) } as const;
    }

    const usage = await tx.leadProviderDailyUsage.upsert({
      where: { workspaceId_provider_day: { workspaceId: opts.workspaceId, provider: "hunter", day: dayStart } },
      create: { workspaceId: opts.workspaceId, provider: "hunter", day: dayStart },
      update: {}
    });
    const reserved = await tx.leadProviderDailyUsage.updateMany({
      where: { id: usage.id, used: { lt: Math.max(0, opts.dailyLimit) } },
      data: { used: { increment: 1 } }
    });
    if (!reserved.count) {
      const retryAt = nextUtcDay(opts.now);
      await tx.leadEmailVerificationCache.update({
        where: { id: current.id },
        data: { status: "quota_deferred", nextVerificationAt: retryAt, leaseUntil: null, lastError: "Cupo diario de Hunter agotado" }
      });
      return { kind: "quota", retryAt } as const;
    }
    return { kind: "claimed" } as const;
  });
}

export async function verifyMailboxCached(opts: {
  workspaceId: string;
  email: string;
  hunterKey: string;
  dailyLimit: number;
  allowProviderCall: boolean;
}): Promise<{ status: string; deferred: boolean; retryAt?: Date; providerCallConsumed: boolean }> {
  const now = new Date();
  const unique = { workspaceId_normalizedEmail_provider: { workspaceId: opts.workspaceId, normalizedEmail: opts.email, provider: "hunter" } } as const;
  let cached = await prisma.leadEmailVerificationCache.findUnique({ where: unique });
  if (cached?.expiresAt && cached.expiresAt > now && ["deliverable", "risky", "invalid"].includes(cached.status)) {
    return { status: cached.status, deferred: false, providerCallConsumed: false };
  }
  if (cached?.nextVerificationAt && cached.nextVerificationAt > now) {
    return { status: "domain_mx_valid", deferred: true, retryAt: cached.nextVerificationAt, providerCallConsumed: false };
  }
  if (!opts.allowProviderCall) return { status: "domain_mx_valid", deferred: true, retryAt: new Date(now.getTime() + 5 * 60_000), providerCallConsumed: false };

  cached = await prisma.leadEmailVerificationCache.upsert({
    where: unique,
    create: { workspaceId: opts.workspaceId, normalizedEmail: opts.email, provider: "hunter", status: "pending" },
    update: {}
  });
  const reservation = await reserveHunterDailySlot({
    workspaceId: opts.workspaceId,
    cacheId: cached.id,
    dailyLimit: opts.dailyLimit,
    now
  });
  if (reservation.kind === "cached") {
    return { status: reservation.status, deferred: false, providerCallConsumed: false };
  }
  if (reservation.kind === "quota") {
    return { status: "domain_mx_valid", deferred: true, retryAt: reservation.retryAt, providerCallConsumed: false };
  }
  if (reservation.kind === "deferred" || reservation.kind === "busy") {
    return { status: "domain_mx_valid", deferred: true, retryAt: reservation.retryAt, providerCallConsumed: false };
  }

  try {
    const result = await hunterVerifyEmail({ email: opts.email, apiKey: opts.hunterKey, throwOnError: true });
    if (!result) throw new Error("Hunter no devolvió un resultado de verificación");
    const status = hunterStatusToVerification(result.status, result.score);
    const ttlDays = status === "deliverable" ? 30 : 7;
    await prisma.leadEmailVerificationCache.update({
      where: { id: cached.id },
      data: {
        status,
        score: result.score,
        verifiedAt: now,
        expiresAt: new Date(now.getTime() + ttlDays * 86_400_000),
        leaseUntil: null,
        nextVerificationAt: null,
        lastError: null,
        metadata: { hunterStatus: result.status }
      }
    });
    return { status, deferred: false, providerCallConsumed: true };
  } catch (error: any) {
    const quotaBlocked = error?.quotaBlocked === true;
    const retryAt = quotaBlocked ? nextUtcDay(now) : new Date(now.getTime() + 15 * 60_000);
    await prisma.leadEmailVerificationCache.update({
      where: { id: cached.id },
      data: {
        status: quotaBlocked ? "quota_deferred" : "pending",
        leaseUntil: null,
        nextVerificationAt: retryAt,
        lastError: String(error?.message ?? error).slice(0, 1000)
      }
    });
    if (quotaBlocked) return { status: "domain_mx_valid", deferred: true, retryAt, providerCallConsumed: true };
    throw error;
  }
}
