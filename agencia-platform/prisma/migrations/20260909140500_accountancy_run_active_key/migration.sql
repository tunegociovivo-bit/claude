ALTER TABLE "AccountancyInvoiceRun" ADD COLUMN "activeKey" TEXT;
CREATE UNIQUE INDEX "AccountancyInvoiceRun_activeKey_key" ON "AccountancyInvoiceRun"("activeKey");
