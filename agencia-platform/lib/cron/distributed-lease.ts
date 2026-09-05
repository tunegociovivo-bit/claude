import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

export class CronTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`La tarea excedió ${timeoutMs} ms`);
    this.name = "CronTimeoutError";
  }
}

export async function acquireCronLease(name: string, owner: string, ttlMs: number): Promise<boolean> {
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error("Duración de lease inválida");
  const ttlSeconds = ttlMs / 1000;
  const rows = await prisma.$queryRaw<Array<{ name: string }>>(Prisma.sql`
    INSERT INTO "CronHeartbeat" ("name", "lastRunAt", "runs", "leaseOwner", "leaseUntil")
    VALUES (${name}, NOW(), 0, ${owner}, NOW() + (${ttlSeconds} * INTERVAL '1 second'))
    ON CONFLICT ("name") DO UPDATE
      SET "leaseOwner" = EXCLUDED."leaseOwner",
          "leaseUntil" = EXCLUDED."leaseUntil"
      WHERE "CronHeartbeat"."leaseUntil" IS NULL
         OR "CronHeartbeat"."leaseUntil" <= NOW()
    RETURNING "name"
  `);
  return rows.length === 1;
}

export async function releaseCronLease(name: string, owner: string): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "CronHeartbeat"
       SET "leaseOwner" = NULL, "leaseUntil" = NULL
     WHERE "name" = ${name} AND "leaseOwner" = ${owner}
  `);
}

export async function runWithTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new CronTimeoutError(timeoutMs));
    }, timeoutMs);
  });
  try {
    return await Promise.race([task(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
