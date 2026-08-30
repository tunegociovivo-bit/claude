ALTER TABLE "ProspectingProspect"
  ADD COLUMN "resolutionAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextResolutionAt" TIMESTAMP(3),
  ADD COLUMN "resolutionError" TEXT;

CREATE INDEX "ProspectingProspect_resolutionStatus_nextResolutionAt_idx"
  ON "ProspectingProspect"("resolutionStatus", "nextResolutionAt");
