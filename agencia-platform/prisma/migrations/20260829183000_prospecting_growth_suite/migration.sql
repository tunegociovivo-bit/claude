ALTER TABLE "ProspectingCampaign"
  ADD COLUMN "teamConfig" JSONB,
  ADD COLUMN "attributionConfig" JSONB;

ALTER TABLE "ProspectingStep"
  ADD COLUMN "condition" JSONB,
  ADD COLUMN "variants" JSONB,
  ADD COLUMN "personalization" TEXT NOT NULL DEFAULT 'template';

ALTER TABLE "ProspectingProspect"
  ADD COLUMN "companyDomain" TEXT,
  ADD COLUMN "score" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "scoreBreakdown" JSONB,
  ADD COLUMN "assignedUserId" TEXT,
  ADD COLUMN "resolutionStatus" TEXT NOT NULL DEFAULT 'unresolved',
  ADD COLUMN "resolutionConfidence" DOUBLE PRECISION,
  ADD COLUMN "enrichedAt" TIMESTAMP(3),
  ADD COLUMN "attributedValueCents" INTEGER;

CREATE TABLE "ProspectingMessage" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "prospectId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "direction" TEXT NOT NULL DEFAULT 'in',
  "body" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'received',
  "externalId" TEXT,
  "classification" TEXT,
  "confidence" DOUBLE PRECISION,
  "read" BOOLEAN NOT NULL DEFAULT false,
  "assignedUserId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProspectingMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProspectingMessage_workspaceId_channel_externalId_key" ON "ProspectingMessage"("workspaceId", "channel", "externalId");
CREATE INDEX "ProspectingMessage_workspaceId_read_createdAt_idx" ON "ProspectingMessage"("workspaceId", "read", "createdAt");
CREATE INDEX "ProspectingMessage_campaignId_createdAt_idx" ON "ProspectingMessage"("campaignId", "createdAt");
CREATE INDEX "ProspectingMessage_prospectId_createdAt_idx" ON "ProspectingMessage"("prospectId", "createdAt");
ALTER TABLE "ProspectingMessage" ADD CONSTRAINT "ProspectingMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectingMessage" ADD CONSTRAINT "ProspectingMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "ProspectingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectingMessage" ADD CONSTRAINT "ProspectingMessage_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "ProspectingProspect"("id") ON DELETE CASCADE ON UPDATE CASCADE;
