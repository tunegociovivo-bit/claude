CREATE TABLE "MobileAutomationJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "phoneKey" TEXT NOT NULL,
    "deviceSerial" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetUrl" TEXT,
    "text" TEXT,
    "facts" TEXT,
    "sourceKind" TEXT NOT NULL,
    "sourceRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "idempotencyKey" TEXT NOT NULL,
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastError" TEXT,
    "preparedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MobileAutomationJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MobileAutomationJobEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MobileAutomationJobEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MobileAutomationPolicy" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "maxDailyPerDevice" INTEGER NOT NULL DEFAULT 20,
    "minIntervalSeconds" INTEGER NOT NULL DEFAULT 60,
    "allowedStartHour" INTEGER NOT NULL DEFAULT 7,
    "allowedEndHour" INTEGER NOT NULL DEFAULT 23,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Madrid',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MobileAutomationPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MobileAutomationJob_workspaceId_idempotencyKey_key"
ON "MobileAutomationJob"("workspaceId", "idempotencyKey");
CREATE INDEX "MobileAutomationJob_workspaceId_status_scheduledAt_idx"
ON "MobileAutomationJob"("workspaceId", "status", "scheduledAt");
CREATE INDEX "MobileAutomationJob_workspaceId_deviceSerial_status_scheduledAt_leaseUntil_idx"
ON "MobileAutomationJob"("workspaceId", "deviceSerial", "status", "scheduledAt", "leaseUntil");
CREATE INDEX "MobileAutomationJobEvent_workspaceId_jobId_createdAt_idx"
ON "MobileAutomationJobEvent"("workspaceId", "jobId", "createdAt");
CREATE UNIQUE INDEX "MobileAutomationPolicy_workspaceId_key"
ON "MobileAutomationPolicy"("workspaceId");

ALTER TABLE "MobileAutomationJob"
ADD CONSTRAINT "MobileAutomationJob_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MobileAutomationJobEvent"
ADD CONSTRAINT "MobileAutomationJobEvent_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MobileAutomationJobEvent"
ADD CONSTRAINT "MobileAutomationJobEvent_jobId_fkey"
FOREIGN KEY ("jobId") REFERENCES "MobileAutomationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MobileAutomationPolicy"
ADD CONSTRAINT "MobileAutomationPolicy_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
