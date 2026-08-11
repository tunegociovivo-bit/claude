-- FASE 3 · Cliente 360 — Índices para las consultas del overview agregado.
--
-- ESTADO: GENERADO, **NO APLICADO** a producción. No cableado al arranque
-- (`prisma db push` no ejecuta esta carpeta). Aplicar a mano fuera de horas punta.
--   psql "$DATABASE_URL" -f este.sql     (CONCURRENTLY no va dentro de transacción)
--
-- El overview consulta por cliente en Task y CalendarEvent, que HOY no tienen
-- índice por clientId (EditorialPost, Deliverable e Invoice ya lo tienen). Se usan
-- índices PARCIALES (clientId IS NOT NULL) porque clientId es opcional en ambos.

-- 1) Tareas por cliente (counts open/overdue/done + últimas por updatedAt).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_ws_client_idx"
  ON "Task" ("workspaceId", "clientId")
  WHERE "clientId" IS NOT NULL;

-- 2) Eventos de calendario por cliente (última actividad / próximos).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "CalendarEvent_ws_client_idx"
  ON "CalendarEvent" ("workspaceId", "clientId")
  WHERE "clientId" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN (sustituye :ws y :cid por valores reales; NO dejar PII en logs):
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT count(*) FROM "Task"
--   WHERE "workspaceId" = :ws AND "clientId" = :cid
--     AND "deletedAt" IS NULL AND "parentId" IS NULL AND "completedAt" IS NULL;
--   -- Antes: Seq Scan filtrado por clientId. Después: Index Scan con "Task_ws_client_idx".
--
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT "startAt" FROM "CalendarEvent"
--   WHERE "workspaceId" = :ws AND "clientId" = :cid
--   ORDER BY "startAt" DESC LIMIT 1;
--   -- Después: Index Scan con "CalendarEvent_ws_client_idx".
--
-- Tras aplicar: ANALYZE "Task"; ANALYZE "CalendarEvent";
-- ─────────────────────────────────────────────────────────────────────────────

-- ROLLBACK (sin bloqueo):
--   DROP INDEX CONCURRENTLY IF EXISTS "Task_ws_client_idx";
--   DROP INDEX CONCURRENTLY IF EXISTS "CalendarEvent_ws_client_idx";
