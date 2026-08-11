-- Slice C — tabla RecurringInvoicePreview (previsualización SHADOW del motor nativo).
-- GENERADO PARA REVISIÓN; NO SE APLICA A MANO.
--
-- Tabla NUEVA (vacía) → `prisma db push` la crea sin lock. Aditiva (compatible con
-- --accept-data-loss=false). NO es una factura: sin número legal, status siempre
-- 'preview'. El @@unique(workspaceId, templateId, occurrenceDate) es la PROTECCIÓN
-- ANTI DOBLE FACTURA. Revisar antes de activar HUB_RECURRING_ENGINE.

-- === Aplicar ===
CREATE TABLE IF NOT EXISTS "RecurringInvoicePreview" (
  "id"             TEXT NOT NULL,
  "workspaceId"    TEXT NOT NULL,
  "templateId"     TEXT NOT NULL,
  "occurrenceDate" TIMESTAMP(3) NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'preview',
  "currency"       TEXT NOT NULL DEFAULT 'EUR',
  "subtotalCents"  INTEGER NOT NULL DEFAULT 0,
  "taxCents"       INTEGER NOT NULL DEFAULT 0,
  "totalCents"     INTEGER NOT NULL DEFAULT 0,
  "payload"        JSONB NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecurringInvoicePreview_pkey" PRIMARY KEY ("id")
);

-- Anti doble-factura: una preview por (workspace, plantilla, fecha de ocurrencia).
CREATE UNIQUE INDEX IF NOT EXISTS "RecurringInvoicePreview_workspaceId_templateId_occurrenceDate_key"
  ON "RecurringInvoicePreview" ("workspaceId", "templateId", "occurrenceDate");

CREATE INDEX IF NOT EXISTS "RecurringInvoicePreview_workspaceId_templateId_idx"
  ON "RecurringInvoicePreview" ("workspaceId", "templateId");

CREATE INDEX IF NOT EXISTS "RecurringInvoicePreview_workspaceId_occurrenceDate_idx"
  ON "RecurringInvoicePreview" ("workspaceId", "occurrenceDate");

ALTER TABLE "RecurringInvoicePreview"
  ADD CONSTRAINT "RecurringInvoicePreview_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecurringInvoicePreview"
  ADD CONSTRAINT "RecurringInvoicePreview_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "RecurringInvoiceTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- === Revertir ===
-- DROP TABLE IF EXISTS "RecurringInvoicePreview";
