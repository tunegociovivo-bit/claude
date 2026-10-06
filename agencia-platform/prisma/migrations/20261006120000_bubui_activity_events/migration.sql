-- Historial de actividad de clientes Bubui (panel admin).
-- Idempotente: se ejecuta en cada arranque desde el CMD del Dockerfile.
CREATE TABLE IF NOT EXISTS "BubuiActivityEvent" (
  "id" TEXT PRIMARY KEY,
  "customerId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "businessId" TEXT,
  "offerId" TEXT,
  "channel" TEXT,
  "platform" TEXT,
  "appBuild" TEXT,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "BubuiActivityEvent_customerId_createdAt_idx" ON "BubuiActivityEvent"("customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "BubuiActivityEvent_type_createdAt_idx" ON "BubuiActivityEvent"("type", "createdAt");

-- Los clics en enlaces de invitación se consultan por código para el historial.
-- Solo si la tabla ya existe: en una base nueva la crea `prisma db push` (que
-- corre después) junto con este índice, y el arranque no debe fallar aquí.
DO $$
BEGIN
  IF to_regclass('"BubuiReferralClick"') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "BubuiReferralClick_code_createdAt_idx" ON "BubuiReferralClick"("code", "createdAt");
  END IF;
END $$;
