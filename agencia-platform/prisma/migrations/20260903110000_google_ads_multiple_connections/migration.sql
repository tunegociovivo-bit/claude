-- Route accountancy clients through one of several permanent Google Ads OAuth connections.
ALTER TABLE "AccountancyInvoiceClient" ADD COLUMN "connectionRef" TEXT;
ALTER TABLE "AccountancyInvoiceRunItem" ADD COLUMN "invoiceDetails" JSONB;
ALTER TABLE "GoogleAdsConnection" ADD COLUMN "accountEmail" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "GoogleAdsConnection" ADD COLUMN "label" TEXT;
DROP INDEX IF EXISTS "GoogleAdsConnection_workspaceId_key";
CREATE UNIQUE INDEX "GoogleAdsConnection_workspaceId_accountEmail_key" ON "GoogleAdsConnection"("workspaceId", "accountEmail");
CREATE INDEX "GoogleAdsConnection_workspaceId_idx" ON "GoogleAdsConnection"("workspaceId");
