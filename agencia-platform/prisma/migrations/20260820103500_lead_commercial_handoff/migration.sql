ALTER TABLE "Lead"
  ADD COLUMN "commercialTaskId" TEXT,
  ADD COLUMN "commercialSendingAt" TIMESTAMP(3),
  ADD COLUMN "commercialSentAt" TIMESTAMP(3);

CREATE INDEX "Lead_workspaceId_commercialSentAt_idx"
  ON "Lead"("workspaceId", "commercialSentAt");
