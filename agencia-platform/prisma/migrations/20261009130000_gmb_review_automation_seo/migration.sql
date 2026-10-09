-- Avisos por email de reseñas nuevas y modos de respuesta automática
ALTER TABLE "GmbClient" ADD COLUMN IF NOT EXISTS "notifyMode" TEXT NOT NULL DEFAULT 'negative';
UPDATE "GmbClient" SET "autoReply" = 'positive' WHERE "autoReply" = 'auto';

-- Informe SEO competitivo
CREATE TABLE IF NOT EXISTS "GmbSeoReport" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GmbSeoReport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "GmbSeoReport_workspaceId_clientId_createdAt_idx" ON "GmbSeoReport"("workspaceId", "clientId", "createdAt");
