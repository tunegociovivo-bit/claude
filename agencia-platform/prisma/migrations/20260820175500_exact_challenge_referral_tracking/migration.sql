ALTER TABLE "BipiOffer"
ADD COLUMN IF NOT EXISTS "usesExactReferralTracking" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "BipiCustomer"
ADD COLUMN IF NOT EXISTS "referralOfferId" TEXT;

ALTER TABLE "BipiBusiness"
ADD COLUMN IF NOT EXISTS "challengeImageUrl" TEXT;
