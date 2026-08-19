CREATE TABLE "MetaClientProfile" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "clientId" TEXT, "metaConnectionId" TEXT,
  "adAccountId" TEXT NOT NULL, "webhookToken" TEXT NOT NULL, "displayName" TEXT NOT NULL, "monthlyBudgetCents" INTEGER NOT NULL DEFAULT 0,
  "targetLeads" INTEGER, "targetCplCents" INTEGER, "targetQualifiedCplCents" INTEGER, "salesValueCents" INTEGER,
  "businessBrief" TEXT, "audienceMemory" JSONB, "creativeMemory" JSONB, "commercialStages" JSONB, "alertRules" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MetaClientProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MetaClientProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "MetaClientProfile_workspaceId_adAccountId_key" ON "MetaClientProfile"("workspaceId", "adAccountId");
CREATE UNIQUE INDEX "MetaClientProfile_webhookToken_key" ON "MetaClientProfile"("webhookToken");
CREATE INDEX "MetaClientProfile_workspaceId_clientId_idx" ON "MetaClientProfile"("workspaceId", "clientId");

CREATE TABLE "MetaLeadAttribution" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "adAccountId" TEXT NOT NULL, "externalLeadId" TEXT NOT NULL,
  "campaignId" TEXT, "campaignName" TEXT, "adsetId" TEXT, "adsetName" TEXT, "adId" TEXT, "adName" TEXT, "formId" TEXT,
  "source" TEXT NOT NULL DEFAULT 'meta', "status" TEXT NOT NULL DEFAULT 'new', "contactName" TEXT, "email" TEXT, "phone" TEXT,
  "qualifiedAt" TIMESTAMP(3), "appointmentAt" TIMESTAMP(3), "proposalAt" TIMESTAMP(3), "wonAt" TIMESTAMP(3), "lostAt" TIMESTAMP(3),
  "revenueCents" INTEGER NOT NULL DEFAULT 0, "qualityScore" INTEGER, "lossReason" TEXT, "metadata" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MetaLeadAttribution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MetaLeadAttribution_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "MetaLeadAttribution_workspaceId_adAccountId_externalLeadId_key" ON "MetaLeadAttribution"("workspaceId", "adAccountId", "externalLeadId");
CREATE INDEX "MetaLeadAttribution_workspaceId_adAccountId_status_idx" ON "MetaLeadAttribution"("workspaceId", "adAccountId", "status");
CREATE INDEX "MetaLeadAttribution_workspaceId_campaignId_occurredAt_idx" ON "MetaLeadAttribution"("workspaceId", "campaignId", "occurredAt");

CREATE TABLE "MetaOptimizationProposal" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "adAccountId" TEXT NOT NULL, "campaignId" TEXT, "kind" TEXT NOT NULL,
  "priority" TEXT NOT NULL DEFAULT 'medium', "title" TEXT NOT NULL, "rationale" TEXT NOT NULL, "proposedAction" JSONB NOT NULL,
  "expectedImpact" JSONB, "evidence" JSONB, "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0, "status" TEXT NOT NULL DEFAULT 'pending',
  "approvedById" TEXT, "approvedAt" TIMESTAMP(3), "executedAt" TIMESTAMP(3), "executionResult" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MetaOptimizationProposal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MetaOptimizationProposal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE
);
CREATE INDEX "MetaOptimizationProposal_workspaceId_adAccountId_status_idx" ON "MetaOptimizationProposal"("workspaceId", "adAccountId", "status");
CREATE INDEX "MetaOptimizationProposal_workspaceId_priority_createdAt_idx" ON "MetaOptimizationProposal"("workspaceId", "priority", "createdAt");
