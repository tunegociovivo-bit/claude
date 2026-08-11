-- FASE 2 · objetivo 7 — Índices selectivos para consultas calientes.
--
-- ESTADO: GENERADO, **NO APLICADO** a producción. Este fichero NO está cableado
-- al arranque (el boot usa `prisma db push`, que NO ejecuta esta carpeta). Se
-- aplica A MANO por un operador/DBA cuando decida, fuera de horas punta.
--
-- Seguridad de aplicación:
--   * CREATE INDEX CONCURRENTLY: NO bloquea escrituras (crea el índice en caliente).
--   * IF NOT EXISTS: idempotente (re-ejecutable sin error).
--   * CONCURRENTLY **no puede ir dentro de una transacción**. Ejecuta este fichero
--     con psql SIN envolverlo en BEGIN/COMMIT:  psql "$DATABASE_URL" -f este.sql
--     (Si tu herramienta de migración envuelve en transacción, ejecútalo aparte.)
--
-- Los identificadores van entre comillas dobles porque Prisma crea las tablas y
-- columnas en camelCase (sin @map en estos modelos).

-- 1) Inbox de leads: la lista de conversaciones ordena por receivedAt DESC y
--    filtra por workspaceId; hoy NO hay índice en receivedAt → scan + sort.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "LeadInboxMessage_workspaceId_receivedAt_idx"
  ON "LeadInboxMessage" ("workspaceId", "receivedAt" DESC);

-- 2) Clientes por estado (filtro del listado / buscador). Client solo tenía
--    @@index([workspaceId]) (cardinalidad 1 en single-tenant → poco selectivo).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Client_workspaceId_status_idx"
  ON "Client" ("workspaceId", "status");

-- 3) Clientes ordenados/prefijo por nombre (buscador remoto: ORDER BY name).
--    NOTA: una búsqueda por SUBCADENA (ILIKE '%q%') no usa este btree; para eso
--    haría falta un índice GIN trigram (pg_trgm). Este cubre orden + prefijo +
--    acotado por workspace, que es la mayoría del coste. GIN trigram queda como
--    mejora opcional (requiere `CREATE EXTENSION pg_trgm`).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Client_workspaceId_name_idx"
  ON "Client" ("workspaceId", "name");

-- 4) Tareas del tablón: getTasksForUi filtra workspaceId + parentId IS NULL +
--    deletedAt IS NULL y ordena por updatedAt DESC (take 1500). Índice PARCIAL
--    que casa exactamente ese predicado → el ORDER BY + LIMIT se sirve del índice.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_ws_updatedAt_active_idx"
  ON "Task" ("workspaceId", "updatedAt" DESC)
  WHERE "parentId" IS NULL AND "deletedAt" IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN (antes/después). Ejecuta con EXPLAIN (ANALYZE, BUFFERS) sustituyendo
-- :ws por un workspaceId real (NO lo dejes en logs con datos reales):
--
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT id FROM "LeadInboxMessage"
--   WHERE "workspaceId" = :ws ORDER BY "receivedAt" DESC LIMIT 1000;
--   -- Antes: Seq Scan + Sort.  Después: Index Scan usando
--   --        "LeadInboxMessage_workspaceId_receivedAt_idx" (sin Sort).
--
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT id,name,status FROM "Client"
--   WHERE "workspaceId" = :ws AND "status" = 'ACTIVE'
--   ORDER BY "name" ASC, id ASC LIMIT 21;
--   -- Después: Index Scan usando "Client_workspaceId_status_idx" /
--   --          "Client_workspaceId_name_idx".
--
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT id FROM "Task"
--   WHERE "workspaceId" = :ws AND "parentId" IS NULL AND "deletedAt" IS NULL
--   ORDER BY "updatedAt" DESC LIMIT 1500;
--   -- Después: Index Scan usando "Task_ws_updatedAt_active_idx" (sin Sort).
--
-- Tras aplicar, corre  ANALYZE "LeadInboxMessage"; ANALYZE "Client"; ANALYZE "Task";
-- para refrescar estadísticas del planner.
-- ─────────────────────────────────────────────────────────────────────────────

-- ROLLBACK (revierte esta migración; también CONCURRENTLY, sin bloqueo):
--   DROP INDEX CONCURRENTLY IF EXISTS "LeadInboxMessage_workspaceId_receivedAt_idx";
--   DROP INDEX CONCURRENTLY IF EXISTS "Client_workspaceId_status_idx";
--   DROP INDEX CONCURRENTLY IF EXISTS "Client_workspaceId_name_idx";
--   DROP INDEX CONCURRENTLY IF EXISTS "Task_ws_updatedAt_active_idx";
