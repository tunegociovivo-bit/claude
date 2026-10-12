CREATE TABLE "InstagramProspectorAgent" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "agentKey" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "version" TEXT,
  "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InstagramProspectorAgent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InstagramProspectorJob" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "config" JSONB NOT NULL,
  "result" JSONB,
  "error" TEXT,
  "claimedByAgentKey" TEXT,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InstagramProspectorJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InstagramProspectorAgent_workspaceId_agentKey_key" ON "InstagramProspectorAgent"("workspaceId", "agentKey");
CREATE INDEX "InstagramProspectorAgent_workspaceId_lastHeartbeatAt_idx" ON "InstagramProspectorAgent"("workspaceId", "lastHeartbeatAt");
CREATE INDEX "InstagramProspectorJob_workspaceId_status_createdAt_idx" ON "InstagramProspectorJob"("workspaceId", "status", "createdAt");
CREATE INDEX "InstagramProspectorJob_workspaceId_claimedByAgentKey_idx" ON "InstagramProspectorJob"("workspaceId", "claimedByAgentKey");

ALTER TABLE "InstagramProspectorAgent"
  ADD CONSTRAINT "InstagramProspectorAgent_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InstagramProspectorJob"
  ADD CONSTRAINT "InstagramProspectorJob_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
