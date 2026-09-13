ALTER TABLE "LeadSearch"
ADD COLUMN IF NOT EXISTS "emailEnrichmentTotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "emailEnrichmentProcessed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "emailEnrichmentFound" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "emailEnrichmentFailed" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Lead"
ADD COLUMN IF NOT EXISTS "emailSource" TEXT,
ADD COLUMN IF NOT EXISTS "emailVerificationStatus" TEXT,
ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "emailEnrichmentStatus" TEXT NOT NULL DEFAULT 'not_requested',
ADD COLUMN IF NOT EXISTS "emailEnrichmentAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "emailEnrichmentNextAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "emailEnrichmentLeaseUntil" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "emailEnrichmentLeaseOwner" TEXT,
ADD COLUMN IF NOT EXISTS "emailEnrichmentError" TEXT,
ADD COLUMN IF NOT EXISTS "multichannelEnrollmentStatus" TEXT NOT NULL DEFAULT 'not_ready',
ADD COLUMN IF NOT EXISTS "multichannelEnrollmentAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "multichannelEnrollmentNextAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "multichannelEnrollmentLeaseUntil" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "multichannelEnrollmentError" TEXT;

ALTER TABLE "LeadMessage"
ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
ADD COLUMN IF NOT EXISTS "prospectingActivityId" TEXT;

ALTER TABLE "ProspectingCampaign"
ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'general',
ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "defaultKey" TEXT,
ADD COLUMN IF NOT EXISTS "senderName" TEXT,
ADD COLUMN IF NOT EXISTS "senderEmail" TEXT,
ADD COLUMN IF NOT EXISTS "replyTo" TEXT,
ADD COLUMN IF NOT EXISTS "complianceMode" TEXT NOT NULL DEFAULT 'review',
ADD COLUMN IF NOT EXISTS "settings" JSONB,
ADD COLUMN IF NOT EXISTS "engineLeaseOwner" TEXT;

ALTER TABLE "ProspectingProspect"
ADD COLUMN IF NOT EXISTS "cadenceAnchorAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "humanRepliedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "autoReplyAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "lastEmailOpenedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "suppressedAt" TIMESTAMP(3);

ALTER TABLE "ProspectingActivity"
ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "recipientKey" TEXT,
ADD COLUMN IF NOT EXISTS "leaseUntil" TIMESTAMP(3);

ALTER TABLE "ProspectingMessage"
ADD COLUMN IF NOT EXISTS "rfcMessageId" TEXT;

CREATE TABLE IF NOT EXISTS "LeadEmailContact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sourceType" TEXT NOT NULL DEFAULT 'website',
    "sourceUrl" TEXT,
    "sourceDomain" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'unknown',
    "verificationProvider" TEXT NOT NULL DEFAULT 'dns',
    "score" INTEGER,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "metadata" JSONB,
    CONSTRAINT "LeadEmailContact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LeadSuppression" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "leadId" TEXT,
    "kind" TEXT NOT NULL,
    "valueHash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadSuppression_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LeadEmailVerificationCache" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'hunter',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "score" INTEGER,
    "verifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "nextVerificationAt" TIMESTAMP(3),
    "lastError" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadEmailVerificationCache_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LeadProviderDailyUsage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadProviderDailyUsage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LeadMigrationState" (
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadMigrationState_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "LeadContactEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "leadId" TEXT,
    "prospectId" TEXT,
    "channel" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT,
    "providerEventId" TEXT,
    "externalMessageId" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadContactEvent_pkey" PRIMARY KEY ("id")
);

-- Los motores históricos no imponían estas claves. Conservamos todas las
-- filas y anulamos únicamente el vínculo/idempotency duplicado en las copias
-- más recientes antes de crear los índices de seguridad.
WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "campaignId", "leadId" ORDER BY "createdAt", "id") AS rn
  FROM "ProspectingProspect" WHERE "leadId" IS NOT NULL
)
UPDATE "ProspectingProspect" AS target SET "leadId" = NULL
FROM ranked WHERE target."id" = ranked."id" AND ranked.rn > 1;

WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "idempotencyKey" ORDER BY "createdAt", "id") AS rn
  FROM "LeadMessage" WHERE "idempotencyKey" IS NOT NULL
)
UPDATE "LeadMessage" AS target SET "idempotencyKey" = NULL
FROM ranked WHERE target."id" = ranked."id" AND ranked.rn > 1;

WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "prospectingActivityId" ORDER BY "createdAt", "id") AS rn
  FROM "LeadMessage" WHERE "prospectingActivityId" IS NOT NULL
)
UPDATE "LeadMessage" AS target SET "prospectingActivityId" = NULL
FROM ranked WHERE target."id" = ranked."id" AND ranked.rn > 1;

WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "defaultKey" ORDER BY "createdAt", "id") AS rn
  FROM "ProspectingCampaign" WHERE "defaultKey" IS NOT NULL
)
UPDATE "ProspectingCampaign" AS target SET "defaultKey" = NULL
FROM ranked WHERE target."id" = ranked."id" AND ranked.rn > 1;

WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "recipientKey" ORDER BY "createdAt", "id") AS rn
  FROM "ProspectingActivity" WHERE "recipientKey" IS NOT NULL
)
UPDATE "ProspectingActivity" AS target SET "recipientKey" = NULL
FROM ranked WHERE target."id" = ranked."id" AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "LeadEmailContact_leadId_normalizedEmail_key" ON "LeadEmailContact"("leadId", "normalizedEmail");
CREATE INDEX IF NOT EXISTS "LeadEmailContact_workspaceId_normalizedEmail_idx" ON "LeadEmailContact"("workspaceId", "normalizedEmail");
CREATE INDEX IF NOT EXISTS "LeadEmailContact_leadId_isPrimary_idx" ON "LeadEmailContact"("leadId", "isPrimary");
CREATE UNIQUE INDEX IF NOT EXISTS "LeadEmailVerificationCache_workspaceId_normalizedEmail_provider_key" ON "LeadEmailVerificationCache"("workspaceId", "normalizedEmail", "provider");
CREATE INDEX IF NOT EXISTS "LeadEmailVerificationCache_workspaceId_provider_verifiedAt_idx" ON "LeadEmailVerificationCache"("workspaceId", "provider", "verifiedAt");
CREATE INDEX IF NOT EXISTS "LeadEmailVerificationCache_status_nextVerificationAt_leaseUntil_idx" ON "LeadEmailVerificationCache"("status", "nextVerificationAt", "leaseUntil");
CREATE UNIQUE INDEX IF NOT EXISTS "LeadProviderDailyUsage_workspaceId_provider_day_key" ON "LeadProviderDailyUsage"("workspaceId", "provider", "day");
CREATE INDEX IF NOT EXISTS "LeadProviderDailyUsage_workspaceId_day_idx" ON "LeadProviderDailyUsage"("workspaceId", "day");
CREATE UNIQUE INDEX IF NOT EXISTS "LeadSuppression_workspaceId_kind_valueHash_key" ON "LeadSuppression"("workspaceId", "kind", "valueHash");
CREATE INDEX IF NOT EXISTS "LeadSuppression_workspaceId_leadId_idx" ON "LeadSuppression"("workspaceId", "leadId");
CREATE UNIQUE INDEX IF NOT EXISTS "LeadContactEvent_workspaceId_provider_providerEventId_key" ON "LeadContactEvent"("workspaceId", "provider", "providerEventId");
CREATE INDEX IF NOT EXISTS "LeadContactEvent_workspaceId_leadId_occurredAt_idx" ON "LeadContactEvent"("workspaceId", "leadId", "occurredAt");
CREATE INDEX IF NOT EXISTS "LeadContactEvent_externalMessageId_idx" ON "LeadContactEvent"("externalMessageId");
CREATE INDEX IF NOT EXISTS "Lead_emailEnrichmentStatus_emailEnrichmentNextAt_emailEnrichmentLeaseUntil_idx" ON "Lead"("emailEnrichmentStatus", "emailEnrichmentNextAt", "emailEnrichmentLeaseUntil");
CREATE INDEX IF NOT EXISTS "Lead_multichannelEnrollmentStatus_multichannelEnrollmentNextAt_multichannelEnrollmentLeaseUntil_idx" ON "Lead"("multichannelEnrollmentStatus", "multichannelEnrollmentNextAt", "multichannelEnrollmentLeaseUntil");
CREATE UNIQUE INDEX IF NOT EXISTS "LeadMessage_idempotencyKey_key" ON "LeadMessage"("idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "LeadMessage_prospectingActivityId_key" ON "LeadMessage"("prospectingActivityId");
CREATE INDEX IF NOT EXISTS "ProspectingCampaign_workspaceId_kind_isDefault_idx" ON "ProspectingCampaign"("workspaceId", "kind", "isDefault");
CREATE UNIQUE INDEX IF NOT EXISTS "ProspectingCampaign_defaultKey_key" ON "ProspectingCampaign"("defaultKey");
CREATE INDEX IF NOT EXISTS "ProspectingProspect_workspaceId_leadId_idx" ON "ProspectingProspect"("workspaceId", "leadId");
CREATE UNIQUE INDEX IF NOT EXISTS "ProspectingProspect_campaignId_leadId_key" ON "ProspectingProspect"("campaignId", "leadId");
CREATE UNIQUE INDEX IF NOT EXISTS "ProspectingActivity_recipientKey_key" ON "ProspectingActivity"("recipientKey");
CREATE INDEX IF NOT EXISTS "ProspectingActivity_externalId_idx" ON "ProspectingActivity"("externalId");
CREATE INDEX IF NOT EXISTS "ProspectingMessage_campaignId_rfcMessageId_idx" ON "ProspectingMessage"("campaignId", "rfcMessageId");

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadEmailContact_workspaceId_fkey') THEN
    ALTER TABLE "LeadEmailContact" ADD CONSTRAINT "LeadEmailContact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadEmailContact_leadId_fkey') THEN
    ALTER TABLE "LeadEmailContact" ADD CONSTRAINT "LeadEmailContact_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadEmailVerificationCache_workspaceId_fkey') THEN
    ALTER TABLE "LeadEmailVerificationCache" ADD CONSTRAINT "LeadEmailVerificationCache_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadProviderDailyUsage_workspaceId_fkey') THEN
    ALTER TABLE "LeadProviderDailyUsage" ADD CONSTRAINT "LeadProviderDailyUsage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadSuppression_workspaceId_fkey') THEN
    ALTER TABLE "LeadSuppression" ADD CONSTRAINT "LeadSuppression_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadContactEvent_workspaceId_fkey') THEN
    ALTER TABLE "LeadContactEvent" ADD CONSTRAINT "LeadContactEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadContactEvent_leadId_fkey') THEN
    ALTER TABLE "LeadContactEvent" ADD CONSTRAINT "LeadContactEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- Preserve existing emails as legacy contacts without scheduling historical outreach.
INSERT INTO "LeadEmailContact" (
  "id", "workspaceId", "leadId", "email", "normalizedEmail", "isPrimary",
  "sourceType", "verificationStatus", "verificationProvider", "discoveredAt"
)
SELECT
  'legacy_' || md5("id" || lower(trim("email"))), "workspaceId", "id", trim("email"),
  lower(trim("email")), true, 'legacy', 'unknown', 'legacy', CURRENT_TIMESTAMP
FROM "Lead"
WHERE "email" IS NOT NULL AND trim("email") <> ''
ON CONFLICT ("leadId", "normalizedEmail") DO NOTHING;
