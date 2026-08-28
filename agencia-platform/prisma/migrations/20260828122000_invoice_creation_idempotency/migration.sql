ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "creationKey" TEXT,
  ADD COLUMN IF NOT EXISTS "creationHash" TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryError" TEXT,
  ADD COLUMN IF NOT EXISTS "sentAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_workspaceId_creationKey_key"
  ON "Invoice"("workspaceId", "creationKey");
