ALTER TABLE "BipiBusiness" ADD COLUMN IF NOT EXISTS "challengeServiceDescription" TEXT;
ALTER TABLE "BipiBusiness" ADD COLUMN IF NOT EXISTS "challengeServicePrice" DOUBLE PRECISION;
ALTER TABLE "BipiBusiness" ADD COLUMN IF NOT EXISTS "challengeServiceMode" TEXT NOT NULL DEFAULT 'local';

ALTER TABLE "BipiOffer" ADD COLUMN IF NOT EXISTS "challengeServiceDescription" TEXT;
ALTER TABLE "BipiOffer" ADD COLUMN IF NOT EXISTS "challengeServicePrice" DOUBLE PRECISION;
ALTER TABLE "BipiOffer" ADD COLUMN IF NOT EXISTS "challengeServiceMode" TEXT;
ALTER TABLE "BipiOffer" ADD COLUMN IF NOT EXISTS "challengeInviterName" TEXT;

ALTER TABLE "BubuiCustomDeal" ADD COLUMN IF NOT EXISTS "serviceDescription" TEXT;
ALTER TABLE "BubuiCustomDeal" ADD COLUMN IF NOT EXISTS "servicePrice" DOUBLE PRECISION;
ALTER TABLE "BubuiCustomDeal" ADD COLUMN IF NOT EXISTS "serviceMode" TEXT NOT NULL DEFAULT 'local';

CREATE TABLE IF NOT EXISTS "BubuiChallengeParticipant" (
  "id" TEXT NOT NULL,
  "offerId" TEXT NOT NULL,
  "referrerCustomerId" TEXT NOT NULL,
  "friendCustomerId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'registered',
  "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "nextFollowupAt" TIMESTAMP(3),
  "followupSentAt" TIMESTAMP(3),
  "decidedAt" TIMESTAMP(3),
  "reminderSentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BubuiChallengeParticipant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BubuiChallengeParticipant_offerId_friendCustomerId_key" ON "BubuiChallengeParticipant"("offerId", "friendCustomerId");
CREATE INDEX IF NOT EXISTS "BubuiChallengeParticipant_businessId_status_nextFollowupAt_idx" ON "BubuiChallengeParticipant"("businessId", "status", "nextFollowupAt");
CREATE INDEX IF NOT EXISTS "BubuiChallengeParticipant_referrerCustomerId_status_idx" ON "BubuiChallengeParticipant"("referrerCustomerId", "status");
