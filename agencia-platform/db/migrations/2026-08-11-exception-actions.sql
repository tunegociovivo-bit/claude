-- Slice 2b — tabla ExceptionAction (persistencia server-side de acciones sobre
-- excepciones). GENERADO PARA REVISIÓN; NO SE APLICA A MANO.
--
-- IMPORTANTE: este proyecto sincroniza el esquema con `prisma db push` en el
-- arranque (package.json:start). Como ExceptionAction es una TABLA NUEVA (vacía),
-- `db push` la crea —incluidos sus índices— SIN lock ni CONCURRENTLY. Este fichero
-- documenta el DDL exacto para auditar la migración y poder aplicarla/revertirla
-- a mano si se prefiere no depender del boot. Es ADITIVO (compatible con
-- --accept-data-loss=false): no toca ni renombra nada existente.
--
-- Revisar antes de activar el flag HUB_EXCEPTIONS_ACTIONS.

-- === Aplicar ===
CREATE TABLE IF NOT EXISTS "ExceptionAction" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "exceptionId" TEXT NOT NULL,
  "dedupeKey"   TEXT NOT NULL,
  "source"      TEXT NOT NULL,
  "kind"        TEXT NOT NULL,
  "action"      TEXT NOT NULL,
  "reason"      TEXT,
  "expiresAt"   TIMESTAMP(3),
  "severity"    TEXT,
  "meta"        JSONB,
  "actorId"     TEXT,
  "revokedAt"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExceptionAction_pkey" PRIMARY KEY ("id")
);

-- Idempotencia: una acción "viva" por (workspace, excepción, acción).
CREATE UNIQUE INDEX IF NOT EXISTS "ExceptionAction_workspaceId_exceptionId_action_key"
  ON "ExceptionAction" ("workspaceId", "exceptionId", "action");

-- Barrido de caducidades y materialización de la bandeja.
CREATE INDEX IF NOT EXISTS "ExceptionAction_workspaceId_expiresAt_idx"
  ON "ExceptionAction" ("workspaceId", "expiresAt");

CREATE INDEX IF NOT EXISTS "ExceptionAction_workspaceId_dedupeKey_idx"
  ON "ExceptionAction" ("workspaceId", "dedupeKey");

-- FK a Workspace con borrado en cascada (patrón de tenant del repo).
ALTER TABLE "ExceptionAction"
  ADD CONSTRAINT "ExceptionAction_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- === Revertir ===
-- DROP TABLE IF EXISTS "ExceptionAction";
