-- Additive billing migration: immutable payment ledger and invoice event log.
CREATE TABLE "InvoicePayment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PAYMENT',
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT NOT NULL DEFAULT 'TRANSFER',
    "reference" TEXT,
    "notes" TEXT,
    "reversesPaymentId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvoicePayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InvoiceEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvoiceEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvoicePayment_reversesPaymentId_key" ON "InvoicePayment"("reversesPaymentId");
CREATE UNIQUE INDEX "Invoice_workspaceId_id_key" ON "Invoice"("workspaceId", "id");
CREATE INDEX "InvoicePayment_workspaceId_invoiceId_occurredAt_idx" ON "InvoicePayment"("workspaceId", "invoiceId", "occurredAt");
CREATE INDEX "InvoicePayment_invoiceId_idx" ON "InvoicePayment"("invoiceId");
CREATE INDEX "InvoiceEvent_workspaceId_invoiceId_createdAt_idx" ON "InvoiceEvent"("workspaceId", "invoiceId", "createdAt");
CREATE INDEX "InvoiceEvent_invoiceId_idx" ON "InvoiceEvent"("invoiceId");

ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_workspaceId_invoiceId_fkey"
  FOREIGN KEY ("workspaceId", "invoiceId") REFERENCES "Invoice"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceEvent" ADD CONSTRAINT "InvoiceEvent_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceEvent" ADD CONSTRAINT "InvoiceEvent_workspaceId_invoiceId_fkey"
  FOREIGN KEY ("workspaceId", "invoiceId") REFERENCES "Invoice"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve historical balances that predate the ledger.
INSERT INTO "InvoicePayment" (
  "id", "workspaceId", "invoiceId", "kind", "amountCents", "currency",
  "occurredAt", "method", "notes", "createdAt"
)
SELECT
  'legacy_payment_' || "id", "workspaceId", "id", 'PAYMENT', "paidCents", "currency",
  COALESCE("paidAt", "updatedAt"), "paymentMethod", 'Saldo migrado del sistema anterior', "updatedAt"
FROM "Invoice"
WHERE "paidCents" > 0;

INSERT INTO "InvoiceEvent" ("id", "workspaceId", "invoiceId", "type", "data", "createdAt")
SELECT
  'legacy_event_' || "id", "workspaceId", "id", 'PAYMENT_BALANCE_MIGRATED',
  jsonb_build_object('paidCents', "paidCents"), "updatedAt"
FROM "Invoice"
WHERE "paidCents" > 0;
