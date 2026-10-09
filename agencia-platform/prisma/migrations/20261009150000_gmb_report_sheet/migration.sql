-- Spreadsheet «Informe GMB» por ficha
ALTER TABLE "GmbClient" ADD COLUMN IF NOT EXISTS "reportSheetUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "GmbClient" ADD COLUMN IF NOT EXISTS "reportSheetSyncedAt" TIMESTAMP(3);
