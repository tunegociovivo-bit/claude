-- Slice D — pausa masiva: tabla RecurringPauseOperation (job/checkpoint) + columna
-- RecurringInvoiceTemplate.statusBeforePause. GENERADO PARA REVISIÓN; NO SE APLICA
-- A MANO. Aditivo (tabla nueva + columna nullable) → `prisma db push` sin lock.
-- Revisar antes de activar HUB_RECURRING_PAUSE.

-- === Aplicar ===

-- Columna para restaurar el estado previo al reanudar (no activa drafts por error).
ALTER TABLE "RecurringInvoiceTemplate" ADD COLUMN IF NOT EXISTS "statusBeforePause" TEXT;

CREATE TABLE IF NOT EXISTS "RecurringPauseOperation" (
  "id"           TEXT NOT NULL,
  "workspaceId"  TEXT NOT NULL,
  "action"       TEXT NOT NULL,
  "status"       TEXT NOT NULL DEFAULT 'running',
  "requestedIds" JSONB NOT NULL,
  "eligibleIds"  JSONB NOT NULL,
  "processedIds" JSONB NOT NULL DEFAULT '[]',
  "results"      JSONB NOT NULL DEFAULT '[]',
  "total"        INTEGER NOT NULL DEFAULT 0,
  "processed"    INTEGER NOT NULL DEFAULT 0,
  "createdById"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecurringPauseOperation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RecurringPauseOperation_workspaceId_status_idx"
  ON "RecurringPauseOperation" ("workspaceId", "status");

ALTER TABLE "RecurringPauseOperation"
  ADD CONSTRAINT "RecurringPauseOperation_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- === Revertir ===
-- DROP TABLE IF EXISTS "RecurringPauseOperation";
-- ALTER TABLE "RecurringInvoiceTemplate" DROP COLUMN IF EXISTS "statusBeforePause";
