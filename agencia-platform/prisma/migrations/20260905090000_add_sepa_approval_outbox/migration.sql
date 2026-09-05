ALTER TABLE "SepaRemittanceRequest"
ADD COLUMN IF NOT EXISTS "approvalTokenEncrypted" TEXT,
ADD COLUMN IF NOT EXISTS "approvalNotificationKey" TEXT;
