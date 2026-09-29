ALTER TABLE "BipiPurchase" ADD COLUMN IF NOT EXISTS "walletPctUsed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BipiPurchase" ADD COLUMN IF NOT EXISTS "challengeProcessedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "BipiPurchase_status_challengeProcessedAt_confirmedAt_idx" ON "BipiPurchase"("status", "challengeProcessedAt", "confirmedAt");
