CREATE TABLE "AccountancyInvoiceClient" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "externalAccountId" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountancyInvoiceClient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountancyInvoiceSchedule" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "dayOfMonth" INTEGER NOT NULL DEFAULT 2,
  "time" TEXT NOT NULL DEFAULT '08:30',
  "timezone" TEXT NOT NULL DEFAULT 'Europe/Madrid',
  "recipients" JSONB NOT NULL,
  "lastRunMonth" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountancyInvoiceSchedule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountancyInvoiceRun" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "periodKey" TEXT NOT NULL,
  "periodFrom" TIMESTAMP(3) NOT NULL,
  "periodTo" TIMESTAMP(3) NOT NULL,
  "trigger" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "recipients" JSONB,
  "archiveFiles" JSONB,
  "emailedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountancyInvoiceRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountancyInvoiceRunItem" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "clientId" TEXT,
  "clientName" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "invoiceCount" INTEGER NOT NULL DEFAULT 0,
  "amountCents" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "files" JSONB,
  "error" TEXT,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountancyInvoiceRunItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountancyInvoiceSchedule_workspaceId_key" ON "AccountancyInvoiceSchedule"("workspaceId");
CREATE INDEX "AccountancyInvoiceClient_workspaceId_enabled_idx" ON "AccountancyInvoiceClient"("workspaceId", "enabled");
CREATE INDEX "AccountancyInvoiceClient_workspaceId_source_idx" ON "AccountancyInvoiceClient"("workspaceId", "source");
CREATE UNIQUE INDEX "AccountancyInvoiceClient_workspaceId_source_externalAccountId_key" ON "AccountancyInvoiceClient"("workspaceId", "source", "externalAccountId");
CREATE INDEX "AccountancyInvoiceRun_workspaceId_createdAt_idx" ON "AccountancyInvoiceRun"("workspaceId", "createdAt");
CREATE INDEX "AccountancyInvoiceRun_workspaceId_periodKey_idx" ON "AccountancyInvoiceRun"("workspaceId", "periodKey");
CREATE INDEX "AccountancyInvoiceRunItem_runId_status_idx" ON "AccountancyInvoiceRunItem"("runId", "status");
CREATE INDEX "AccountancyInvoiceRunItem_clientId_idx" ON "AccountancyInvoiceRunItem"("clientId");

ALTER TABLE "AccountancyInvoiceClient" ADD CONSTRAINT "AccountancyInvoiceClient_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountancyInvoiceSchedule" ADD CONSTRAINT "AccountancyInvoiceSchedule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountancyInvoiceRun" ADD CONSTRAINT "AccountancyInvoiceRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountancyInvoiceRunItem" ADD CONSTRAINT "AccountancyInvoiceRunItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AccountancyInvoiceRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountancyInvoiceRunItem" ADD CONSTRAINT "AccountancyInvoiceRunItem_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "AccountancyInvoiceClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
