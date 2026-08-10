ALTER TABLE "Workspace" ADD COLUMN "invoiceRemindersEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "InvoiceDelivery" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'INVOICE',
  "reminderKey" TEXT,
  "recipient" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "provider" TEXT NOT NULL DEFAULT 'RESEND',
  "providerId" TEXT,
  "dedupeKey" TEXT NOT NULL,
  "error" TEXT,
  "createdById" TEXT,
  "sentAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "providerEventAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InvoiceDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InvoiceDeliveryEvent" (
  "id" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "webhookId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "eventAt" TIMESTAMP(3) NOT NULL,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceDeliveryEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvoiceDelivery_providerId_key" ON "InvoiceDelivery"("providerId");
CREATE UNIQUE INDEX "InvoiceDelivery_dedupeKey_key" ON "InvoiceDelivery"("dedupeKey");
CREATE INDEX "InvoiceDelivery_workspaceId_invoiceId_createdAt_idx" ON "InvoiceDelivery"("workspaceId", "invoiceId", "createdAt");
CREATE INDEX "InvoiceDelivery_status_idx" ON "InvoiceDelivery"("status");
CREATE UNIQUE INDEX "InvoiceDeliveryEvent_webhookId_key" ON "InvoiceDeliveryEvent"("webhookId");
CREATE INDEX "InvoiceDeliveryEvent_deliveryId_eventAt_idx" ON "InvoiceDeliveryEvent"("deliveryId", "eventAt");

ALTER TABLE "InvoiceDelivery" ADD CONSTRAINT "InvoiceDelivery_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceDelivery" ADD CONSTRAINT "InvoiceDelivery_workspaceId_invoiceId_fkey"
  FOREIGN KEY ("workspaceId", "invoiceId") REFERENCES "Invoice"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceDeliveryEvent" ADD CONSTRAINT "InvoiceDeliveryEvent_deliveryId_fkey"
  FOREIGN KEY ("deliveryId") REFERENCES "InvoiceDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
