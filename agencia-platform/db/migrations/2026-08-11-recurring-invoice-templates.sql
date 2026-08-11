-- Slice A — tabla RecurringInvoiceTemplate (plantillas de facturas recurrentes).
-- GENERADO PARA REVISIÓN; NO SE APLICA A MANO.
--
-- Este proyecto sincroniza el esquema con `prisma db push` en el arranque. Como
-- RecurringInvoiceTemplate es una TABLA NUEVA (vacía), `db push` la crea —incluidos
-- sus índices— SIN lock ni CONCURRENTLY. Este fichero documenta el DDL exacto para
-- auditar la migración. Es ADITIVO (compatible con --accept-data-loss=false): no
-- toca ni renombra nada existente. Revisar antes de activar HUB_RECURRING_INVOICES.

-- === Aplicar ===
CREATE TABLE IF NOT EXISTS "RecurringInvoiceTemplate" (
  "id"               TEXT NOT NULL,
  "workspaceId"      TEXT NOT NULL,
  "issuerId"         TEXT,
  "clientId"         TEXT,
  "issuerSnapshot"   JSONB,
  "clientSnapshot"   JSONB,
  "lines"            JSONB NOT NULL,
  "currency"         TEXT NOT NULL DEFAULT 'EUR',
  "subtotalCents"    INTEGER NOT NULL DEFAULT 0,
  "taxCents"         INTEGER NOT NULL DEFAULT 0,
  "totalCents"       INTEGER NOT NULL DEFAULT 0,
  "intervalMonths"   INTEGER NOT NULL DEFAULT 1,
  "dayOfMonth"       INTEGER,
  "anchorDate"       TIMESTAMP(3),
  "startDate"        TIMESTAMP(3),
  "endDate"          TIMESTAMP(3),
  "nextIssueAt"      TIMESTAMP(3),
  "timezone"         TEXT NOT NULL DEFAULT 'Europe/Madrid',
  "status"           TEXT NOT NULL DEFAULT 'draft',
  "series"           TEXT,
  "paymentMethod"    TEXT NOT NULL DEFAULT 'TRANSFER',
  "sepa"             BOOLEAN NOT NULL DEFAULT false,
  "source"           TEXT NOT NULL DEFAULT 'HUB',
  "externalId"       TEXT,
  "originalSnapshot" JSONB,
  "checksum"         TEXT,
  "syncStatus"       TEXT NOT NULL DEFAULT 'ok',
  "syncError"        TEXT,
  "pausedInHolded"   BOOLEAN NOT NULL DEFAULT false,
  "pausedInHoldedAt" TIMESTAMP(3),
  "createdById"      TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecurringInvoiceTemplate_pkey" PRIMARY KEY ("id")
);

-- Idempotencia de importación: una plantilla por (workspace, source, externalId).
CREATE UNIQUE INDEX IF NOT EXISTS "RecurringInvoiceTemplate_workspaceId_source_externalId_key"
  ON "RecurringInvoiceTemplate" ("workspaceId", "source", "externalId");

CREATE INDEX IF NOT EXISTS "RecurringInvoiceTemplate_workspaceId_status_idx"
  ON "RecurringInvoiceTemplate" ("workspaceId", "status");

CREATE INDEX IF NOT EXISTS "RecurringInvoiceTemplate_workspaceId_nextIssueAt_idx"
  ON "RecurringInvoiceTemplate" ("workspaceId", "nextIssueAt");

ALTER TABLE "RecurringInvoiceTemplate"
  ADD CONSTRAINT "RecurringInvoiceTemplate_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- === Revertir ===
-- DROP TABLE IF EXISTS "RecurringInvoiceTemplate";
