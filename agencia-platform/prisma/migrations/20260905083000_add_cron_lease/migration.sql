ALTER TABLE "CronHeartbeat"
ADD COLUMN "leaseOwner" TEXT,
ADD COLUMN "leaseUntil" TIMESTAMP(3);
