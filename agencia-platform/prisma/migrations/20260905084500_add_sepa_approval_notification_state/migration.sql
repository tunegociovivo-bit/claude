ALTER TABLE "SepaRemittanceRequest"
ADD COLUMN "approvalNotifiedAt" TIMESTAMP(3),
ADD COLUMN "approvalTokenEncrypted" TEXT,
ADD COLUMN "approvalNotificationKey" TEXT;

-- Las solicitudes existentes ya pasaron por el flujo de notificación previo.
-- No deben reemitirse masivamente al estrenar el campo de recuperación.
UPDATE "SepaRemittanceRequest"
SET "approvalNotifiedAt" = "updatedAt"
WHERE "status" = 'PENDING_APPROVAL';
