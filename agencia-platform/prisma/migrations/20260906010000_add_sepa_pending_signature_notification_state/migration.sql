ALTER TABLE "SepaRemittanceRequest"
ADD COLUMN "pendingSignatureNotifiedAt" TIMESTAMP(3),
ADD COLUMN "pendingSignatureNotificationClaimedAt" TIMESTAMP(3);

-- Las solicitudes que ya estaban pendientes de firma antes de desplegar esta
-- protección ya fueron notificadas por el flujo anterior. Evita reenviarlas.
UPDATE "SepaRemittanceRequest"
SET "pendingSignatureNotifiedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP)
WHERE "status" = 'PENDING_SIGNATURE';
