ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "commercialTaskId" TEXT,
  ADD COLUMN IF NOT EXISTS "commercialSendingAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "commercialSentAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Lead_workspaceId_commercialSentAt_idx"
  ON "Lead"("workspaceId", "commercialSentAt");
