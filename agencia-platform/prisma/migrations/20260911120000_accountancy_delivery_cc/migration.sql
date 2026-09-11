ALTER TABLE "AccountancyInvoiceSchedule"
ADD COLUMN "ccRecipients" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "AccountancyInvoiceRun"
ADD COLUMN "ccRecipients" JSONB;
