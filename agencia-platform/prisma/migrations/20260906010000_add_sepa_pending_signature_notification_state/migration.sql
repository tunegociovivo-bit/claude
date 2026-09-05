ALTER TABLE "SepaRemittanceRequest"
ADD COLUMN "pendingSignatureNotifiedAt" TIMESTAMP(3),
ADD COLUMN "pendingSignatureNotificationClaimedAt" TIMESTAMP(3);

-- Estas cinco solicitudes tienen evidencia externa de entrega confirmada en el
-- incidente que originó esta migración. No se marcan otras filas históricas.
UPDATE "SepaRemittanceRequest"
SET "pendingSignatureNotifiedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP)
WHERE "status" = 'PENDING_SIGNATURE'
  AND "invoiceNumber" IN ('FAC-003058', 'FAC-003059', 'FAC-003060', 'FAC-003063', 'FAC-003065');
