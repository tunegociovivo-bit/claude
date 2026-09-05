ALTER TABLE "SepaRemittanceRequest"
ADD COLUMN "pendingSignatureNotifiedAt" TIMESTAMP(3),
ADD COLUMN "pendingSignatureNotificationClaimedAt" TIMESTAMP(3);
