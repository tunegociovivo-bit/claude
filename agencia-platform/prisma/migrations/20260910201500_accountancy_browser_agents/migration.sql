CREATE TABLE "AccountancyBrowserAgent" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "agentKey" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "version" TEXT,
  "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountancyBrowserAgent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AccountancyBrowserAgent_workspaceId_agentKey_key" ON "AccountancyBrowserAgent"("workspaceId", "agentKey");
CREATE INDEX "AccountancyBrowserAgent_workspaceId_lastHeartbeatAt_idx" ON "AccountancyBrowserAgent"("workspaceId", "lastHeartbeatAt");
ALTER TABLE "AccountancyBrowserAgent" ADD CONSTRAINT "AccountancyBrowserAgent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
