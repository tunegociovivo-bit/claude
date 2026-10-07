-- GMB Hub: varias cuentas de Google por workspace y ficha vinculada a su cuenta (idempotente).
ALTER TABLE "GmbClient" ADD COLUMN IF NOT EXISTS "googleConnectionId" TEXT NOT NULL DEFAULT '';
DROP INDEX IF EXISTS "GmbGoogleConnection_workspaceId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "GmbGoogleConnection_workspaceId_email_key" ON "GmbGoogleConnection"("workspaceId", "email");
CREATE INDEX IF NOT EXISTS "GmbGoogleConnection_workspaceId_idx" ON "GmbGoogleConnection"("workspaceId");
