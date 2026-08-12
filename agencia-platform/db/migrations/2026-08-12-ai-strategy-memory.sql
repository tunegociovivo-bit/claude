-- Memoria de estrategias DURABLE y reutilizable (aprendizaje). GENERADO PARA REVISIÓN;
-- NO SE APLICA A MANO — `prisma db push` la crea al arrancar (tabla nueva vacía → sin
-- lock). Aditiva y compatible hacia atrás. Con AI_RUN_ORCHESTRATOR off nada la consulta.

-- === Aplicar ===
CREATE TABLE IF NOT EXISTS "AiStrategyMemory" (
  "id"               TEXT NOT NULL,
  "workspaceId"      TEXT NOT NULL,
  "taskSignature"    TEXT NOT NULL,
  "rootCause"        TEXT NOT NULL,
  "strategyKind"     TEXT NOT NULL,
  "provider"         TEXT NOT NULL DEFAULT '',
  "model"            TEXT NOT NULL DEFAULT '',
  "tool"             TEXT NOT NULL DEFAULT '',
  "successCount"     INTEGER NOT NULL DEFAULT 0,
  "failureCount"     INTEGER NOT NULL DEFAULT 0,
  "score"            DOUBLE PRECISION NOT NULL DEFAULT 0,
  "lastOutcome"      TEXT,
  "lastEvidence"     JSONB,
  "lastAttemptToken" TEXT,
  "lastUsedAt"       TIMESTAMP(3),
  "version"          INTEGER NOT NULL DEFAULT 0,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiStrategyMemory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AiStrategyMemory_ws_sig_cause_strat_prov_model_key"
  ON "AiStrategyMemory" ("workspaceId", "taskSignature", "rootCause", "strategyKind", "provider", "model");
CREATE INDEX IF NOT EXISTS "AiStrategyMemory_ws_sig_cause_score_idx"
  ON "AiStrategyMemory" ("workspaceId", "taskSignature", "rootCause", "score");
ALTER TABLE "AiStrategyMemory" ADD CONSTRAINT "AiStrategyMemory_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- === Revertir === (aditivo: seguro; tabla nueva vacía)
-- DROP TABLE IF EXISTS "AiStrategyMemory";
