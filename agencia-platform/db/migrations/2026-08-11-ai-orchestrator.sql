-- Slice 2c — orquestador de recuperación de Sonia: AiOrchestration, AiRunStep,
-- AiApproval. GENERADO PARA REVISIÓN; NO SE APLICA A MANO. Aditivo (tablas nuevas
-- vacías) → `prisma db push` las crea sin lock. IMPORTANTE (orden operativo):
-- aplicar ANTES de activar AI_RUN_ORCHESTRATOR (si no, el endpoint 500 al consultar
-- una tabla inexistente). Con el flag off (por defecto) el endpoint 404 y nada
-- consulta estas tablas.

-- === Aplicar ===
CREATE TABLE IF NOT EXISTS "AiOrchestration" (
  "id"           TEXT NOT NULL,
  "workspaceId"  TEXT NOT NULL,
  "taskId"       TEXT NOT NULL,
  "runId"        TEXT,
  "createdById"  TEXT,
  "state"        TEXT NOT NULL DEFAULT 'queued',
  "version"      INTEGER NOT NULL DEFAULT 0,
  "mode"         TEXT NOT NULL DEFAULT 'shadow',
  "strategy"     TEXT,
  "plan"         JSONB,
  "limits"       JSONB,
  "usage"        JSONB,
  "fingerprints" JSONB,
  "decision"     JSONB,
  "lastError"      TEXT,
  "nextRunAt"      TIMESTAMP(3),
  "leaseOwner"     TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiOrchestration_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AiOrchestration_workspaceId_taskId_key" ON "AiOrchestration" ("workspaceId", "taskId");
CREATE INDEX IF NOT EXISTS "AiOrchestration_workspaceId_state_idx" ON "AiOrchestration" ("workspaceId", "state");
CREATE INDEX IF NOT EXISTS "AiOrchestration_workspaceId_nextRunAt_idx" ON "AiOrchestration" ("workspaceId", "nextRunAt");
CREATE INDEX IF NOT EXISTS "AiOrchestration_state_nextRunAt_leaseExpiresAt_idx" ON "AiOrchestration" ("state", "nextRunAt", "leaseExpiresAt");
ALTER TABLE "AiOrchestration" ADD CONSTRAINT "AiOrchestration_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "AiRunStep" (
  "id"              TEXT NOT NULL,
  "workspaceId"     TEXT NOT NULL,
  "orchestrationId" TEXT NOT NULL,
  "seq"             INTEGER NOT NULL,
  "phase"           TEXT NOT NULL,
  "strategy"        TEXT,
  "provider"        TEXT,
  "model"           TEXT,
  "ok"              BOOLEAN,
  "diagnosis"       TEXT,
  "costUsd"         DECIMAL(10,4),
  "tokensIn"        INTEGER,
  "tokensOut"       INTEGER,
  "fingerprint"     TEXT,
  "error"           TEXT,
  "evidence"        JSONB,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiRunStep_pkey" PRIMARY KEY ("id")
);
-- Unicidad del seq por orquestación → log append-only monótono sin duplicados.
CREATE UNIQUE INDEX IF NOT EXISTS "AiRunStep_orchestrationId_seq_key" ON "AiRunStep" ("orchestrationId", "seq");
CREATE INDEX IF NOT EXISTS "AiRunStep_workspaceId_orchestrationId_seq_idx" ON "AiRunStep" ("workspaceId", "orchestrationId", "seq");
ALTER TABLE "AiRunStep" ADD CONSTRAINT "AiRunStep_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiRunStep" ADD CONSTRAINT "AiRunStep_orchestrationId_fkey"
  FOREIGN KEY ("orchestrationId") REFERENCES "AiOrchestration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "AiApproval" (
  "id"             TEXT NOT NULL,
  "workspaceId"    TEXT NOT NULL,
  "action"         TEXT NOT NULL,
  "scope"          TEXT,
  "sensitive"      BOOLEAN NOT NULL DEFAULT false,
  "maxAmountCents" INTEGER,
  "maxVolume"      INTEGER,
  "remaining"      INTEGER,
  "grantedById"    TEXT,
  "reason"         TEXT,
  "expiresAt"      TIMESTAMP(3),
  "revokedAt"      TIMESTAMP(3),
  "revokedById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiApproval_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AiApproval_workspaceId_action_expiresAt_idx" ON "AiApproval" ("workspaceId", "action", "expiresAt");
ALTER TABLE "AiApproval" ADD CONSTRAINT "AiApproval_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Auditoría INMUTABLE (append-only) de concesión/revocación de aprobaciones.
CREATE TABLE IF NOT EXISTS "AiApprovalEvent" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "approvalId"  TEXT NOT NULL,
  "event"       TEXT NOT NULL,
  "actorId"     TEXT,
  "reason"      TEXT,
  "snapshot"    JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiApprovalEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AiApprovalEvent_workspaceId_approvalId_createdAt_idx" ON "AiApprovalEvent" ("workspaceId", "approvalId", "createdAt");
ALTER TABLE "AiApprovalEvent" ADD CONSTRAINT "AiApprovalEvent_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiApprovalEvent" ADD CONSTRAINT "AiApprovalEvent_approvalId_fkey"
  FOREIGN KEY ("approvalId") REFERENCES "AiApproval"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Circuit breaker DURABLE por (workspace, proveedor). La fila es el lock (single-probe).
CREATE TABLE IF NOT EXISTS "AiProviderBreaker" (
  "id"               TEXT NOT NULL,
  "workspaceId"      TEXT NOT NULL,
  "provider"         TEXT NOT NULL,
  "state"            TEXT NOT NULL DEFAULT 'closed',
  "failureCount"     INTEGER NOT NULL DEFAULT 0,
  "windowStartedAt"  TIMESTAMP(3),
  "openedAt"         TIMESTAMP(3),
  "lastFailureAt"    TIMESTAMP(3),
  "lastAttemptToken" TEXT,
  "probeOwner"       TEXT,
  "probeExpiresAt"   TIMESTAMP(3),
  "version"          INTEGER NOT NULL DEFAULT 0,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiProviderBreaker_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AiProviderBreaker_workspaceId_provider_key" ON "AiProviderBreaker" ("workspaceId", "provider");
CREATE INDEX IF NOT EXISTS "AiProviderBreaker_workspaceId_provider_state_idx" ON "AiProviderBreaker" ("workspaceId", "provider", "state");
ALTER TABLE "AiProviderBreaker" ADD CONSTRAINT "AiProviderBreaker_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- === Revertir === (aditivo: seguro de revertir; las tablas nuevas están vacías)
-- DROP TABLE IF EXISTS "AiProviderBreaker";
-- DROP TABLE IF EXISTS "AiApprovalEvent";
-- DROP TABLE IF EXISTS "AiRunStep";
-- DROP TABLE IF EXISTS "AiApproval";
-- DROP TABLE IF EXISTS "AiOrchestration";
