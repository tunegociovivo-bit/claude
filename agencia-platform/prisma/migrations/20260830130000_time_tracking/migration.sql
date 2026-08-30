CREATE TABLE "TimeTrackerSession" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "projectId" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "source" TEXT NOT NULL DEFAULT 'WEB',
  "deviceId" TEXT,
  "note" TEXT,
  "isPrivate" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TimeTrackerSession_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "TimeTrackerActivity" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT,
  "deviceId" TEXT NOT NULL,
  "bucketStart" TIMESTAMP(3) NOT NULL,
  "durationSec" INTEGER NOT NULL,
  "appName" TEXT,
  "domain" TEXT,
  "windowTitle" TEXT,
  "projectId" TEXT,
  "category" TEXT NOT NULL DEFAULT 'NEUTRAL',
  "productive" BOOLEAN,
  "idle" BOOLEAN NOT NULL DEFAULT false,
  "privateMode" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TimeTrackerActivity_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TimeTrackerSession_workspaceId_startedAt_idx" ON "TimeTrackerSession"("workspaceId", "startedAt");
CREATE INDEX "TimeTrackerSession_userId_endedAt_idx" ON "TimeTrackerSession"("userId", "endedAt");
CREATE INDEX "TimeTrackerActivity_workspaceId_bucketStart_idx" ON "TimeTrackerActivity"("workspaceId", "bucketStart");
CREATE INDEX "TimeTrackerActivity_userId_bucketStart_idx" ON "TimeTrackerActivity"("userId", "bucketStart");
CREATE UNIQUE INDEX "TimeTrackerActivity_workspaceId_userId_deviceId_bucketStart_appName_domain_key" ON "TimeTrackerActivity"("workspaceId", "userId", "deviceId", "bucketStart", "appName", "domain");
ALTER TABLE "TimeTrackerSession" ADD CONSTRAINT "TimeTrackerSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimeTrackerSession" ADD CONSTRAINT "TimeTrackerSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimeTrackerActivity" ADD CONSTRAINT "TimeTrackerActivity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimeTrackerActivity" ADD CONSTRAINT "TimeTrackerActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "TimeTrackerScreenshot" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL, "capturedAt" TIMESTAMP(3) NOT NULL, "s3Key" TEXT NOT NULL,
  "width" INTEGER, "height" INTEGER, "blurred" BOOLEAN NOT NULL DEFAULT false,
  "appName" TEXT, "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TimeTrackerScreenshot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TimeTrackerScreenshot_workspaceId_capturedAt_idx" ON "TimeTrackerScreenshot"("workspaceId", "capturedAt");
CREATE INDEX "TimeTrackerScreenshot_userId_capturedAt_idx" ON "TimeTrackerScreenshot"("userId", "capturedAt");
CREATE INDEX "TimeTrackerScreenshot_expiresAt_idx" ON "TimeTrackerScreenshot"("expiresAt");
ALTER TABLE "TimeTrackerScreenshot" ADD CONSTRAINT "TimeTrackerScreenshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimeTrackerScreenshot" ADD CONSTRAINT "TimeTrackerScreenshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
