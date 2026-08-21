ALTER TABLE "BipiBusiness" ADD COLUMN IF NOT EXISTS "challengeFirstFollowupHours" INTEGER NOT NULL DEFAULT 24;
ALTER TABLE "BipiBusiness" ADD COLUMN IF NOT EXISTS "challengeRepeatFollowupDays" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "BubuiChallengeParticipant" ADD COLUMN IF NOT EXISTS "contactedAt" TIMESTAMP(3);
ALTER TABLE "BubuiChallengeParticipant" ADD COLUMN IF NOT EXISTS "contactChannel" TEXT;
