import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Exclusión entre instancias para procesos periódicos (portado del Hub).
export async function acquireCronLease(name: string, owner: string, ttlMs: number): Promise<boolean> {
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error("Duración de lease inválida");
  const ttlSeconds = ttlMs / 1000;
  const rows = await prisma.$queryRaw<Array<{ name: string }>>(Prisma.sql`
    INSERT INTO "CronHeartbeat" ("name", "lastRunAt", "runs", "leaseOwner", "leaseUntil")
    VALUES (${name}, NOW(), 0, ${owner}, NOW() + (${ttlSeconds} * INTERVAL '1 second'))
    ON CONFLICT ("name") DO UPDATE
      SET "leaseOwner" = EXCLUDED."leaseOwner",
          "leaseUntil" = EXCLUDED."leaseUntil",
          "lastRunAt" = NOW(),
          "runs" = "CronHeartbeat"."runs" + 1
      WHERE "CronHeartbeat"."leaseUntil" IS NULL
         OR "CronHeartbeat"."leaseUntil" <= NOW()
    RETURNING "name"
  `);
  return rows.length === 1;
}

export async function releaseCronLease(name: string, owner: string): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "CronHeartbeat" SET "leaseOwner" = NULL, "leaseUntil" = NULL
     WHERE "name" = ${name} AND "leaseOwner" = ${owner}
  `);
}
