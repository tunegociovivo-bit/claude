-- FASE 4a · Bandeja de excepciones — Índices para los collectors de vencidos.
--
-- ESTADO: GENERADO, **NO APLICADO**. No cableado al arranque. Aplicar a mano:
--   psql "$DATABASE_URL" -f este.sql     (CONCURRENTLY fuera de transacción)
--
-- El aggregator consulta facturas y tareas VENCIDAS por workspace; hoy Invoice
-- no tiene índice por dueDate y Task no lo tiene por dueDate/completedAt.
-- (AiDraft/AiAgentRun ya tienen [workspaceId, status].)

-- 1) Facturas vencidas: WHERE workspaceId + status='ISSUED' + dueDate < now.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Invoice_ws_status_dueDate_idx"
  ON "Invoice" ("workspaceId", "status", "dueDate");

-- 2) Tareas vencidas abiertas: índice PARCIAL que casa el predicado exacto.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_ws_overdue_open_idx"
  ON "Task" ("workspaceId", "dueDate")
  WHERE "completedAt" IS NULL AND "parentId" IS NULL AND "deletedAt" IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN (sustituye :ws; NO dejar PII en logs):
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT id FROM "Invoice"
--   WHERE "workspaceId" = :ws AND "status" = 'ISSUED' AND "dueDate" < now()
--   ORDER BY "dueDate" ASC LIMIT 300;
--   -- Después: Index Scan con "Invoice_ws_status_dueDate_idx".
--
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT id FROM "Task"
--   WHERE "workspaceId" = :ws AND "completedAt" IS NULL AND "parentId" IS NULL
--     AND "deletedAt" IS NULL AND "dueDate" < now()
--   ORDER BY "dueDate" ASC LIMIT 300;
--   -- Después: Index Scan con "Task_ws_overdue_open_idx".
-- ─────────────────────────────────────────────────────────────────────────────

-- ROLLBACK:
--   DROP INDEX CONCURRENTLY IF EXISTS "Invoice_ws_status_dueDate_idx";
--   DROP INDEX CONCURRENTLY IF EXISTS "Task_ws_overdue_open_idx";
