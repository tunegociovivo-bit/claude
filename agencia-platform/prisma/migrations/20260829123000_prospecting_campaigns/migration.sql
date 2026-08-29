CREATE TABLE "ProspectingCampaign" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'linkedin',
  "sourceUrl" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "objective" TEXT NOT NULL DEFAULT 'meeting',
  "dailyLimit" INTEGER NOT NULL DEFAULT 30,
  "timezone" TEXT NOT NULL DEFAULT 'Europe/Madrid',
  "activeWeekdays" JSONB,
  "startHour" INTEGER NOT NULL DEFAULT 9,
  "endHour" INTEGER NOT NULL DEFAULT 18,
  "engineLeaseUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProspectingCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProspectingStep" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "order" INTEGER NOT NULL,
  "channel" TEXT NOT NULL,
  "delayHours" INTEGER NOT NULL DEFAULT 0,
  "templateBody" TEXT,
  "subject" TEXT,
  "stopOnReply" BOOLEAN NOT NULL DEFAULT true,
  "requiresReview" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProspectingStep_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProspectingProspect" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "leadId" TEXT,
  "firstName" TEXT,
  "lastName" TEXT,
  "companyName" TEXT,
  "jobTitle" TEXT,
  "linkedinUrl" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "website" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "currentStep" INTEGER NOT NULL DEFAULT 0,
  "nextActionAt" TIMESTAMP(3),
  "lastContactedAt" TIMESTAMP(3),
  "repliedAt" TIMESTAMP(3),
  "stopReason" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProspectingProspect_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProspectingActivity" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "prospectId" TEXT,
  "stepId" TEXT,
  "idempotencyKey" TEXT,
  "channel" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "detail" TEXT,
  "externalId" TEXT,
  "scheduledAt" TIMESTAMP(3),
  "executedAt" TIMESTAMP(3),
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProspectingActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProspectingCampaign_workspaceId_status_idx" ON "ProspectingCampaign"("workspaceId", "status");
CREATE INDEX "ProspectingCampaign_workspaceId_createdAt_idx" ON "ProspectingCampaign"("workspaceId", "createdAt");
CREATE UNIQUE INDEX "ProspectingStep_campaignId_order_key" ON "ProspectingStep"("campaignId", "order");
CREATE INDEX "ProspectingStep_campaignId_idx" ON "ProspectingStep"("campaignId");
CREATE INDEX "ProspectingProspect_workspaceId_status_nextActionAt_idx" ON "ProspectingProspect"("workspaceId", "status", "nextActionAt");
CREATE INDEX "ProspectingProspect_campaignId_status_idx" ON "ProspectingProspect"("campaignId", "status");
CREATE INDEX "ProspectingProspect_workspaceId_email_idx" ON "ProspectingProspect"("workspaceId", "email");
CREATE INDEX "ProspectingProspect_workspaceId_linkedinUrl_idx" ON "ProspectingProspect"("workspaceId", "linkedinUrl");
CREATE INDEX "ProspectingProspect_workspaceId_phone_idx" ON "ProspectingProspect"("workspaceId", "phone");
CREATE INDEX "ProspectingActivity_workspaceId_status_scheduledAt_idx" ON "ProspectingActivity"("workspaceId", "status", "scheduledAt");
CREATE INDEX "ProspectingActivity_campaignId_createdAt_idx" ON "ProspectingActivity"("campaignId", "createdAt");
CREATE INDEX "ProspectingActivity_prospectId_createdAt_idx" ON "ProspectingActivity"("prospectId", "createdAt");
CREATE UNIQUE INDEX "ProspectingActivity_idempotencyKey_key" ON "ProspectingActivity"("idempotencyKey");

ALTER TABLE "ProspectingCampaign" ADD CONSTRAINT "ProspectingCampaign_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectingStep" ADD CONSTRAINT "ProspectingStep_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "ProspectingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectingProspect" ADD CONSTRAINT "ProspectingProspect_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectingProspect" ADD CONSTRAINT "ProspectingProspect_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "ProspectingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectingActivity" ADD CONSTRAINT "ProspectingActivity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectingActivity" ADD CONSTRAINT "ProspectingActivity_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "ProspectingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectingActivity" ADD CONSTRAINT "ProspectingActivity_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "ProspectingProspect"("id") ON DELETE CASCADE ON UPDATE CASCADE;
