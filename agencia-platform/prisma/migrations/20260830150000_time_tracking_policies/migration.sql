CREATE TABLE "TimeTrackerPolicy" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "trackingEnabled" BOOLEAN NOT NULL DEFAULT true,
  "collectApps" BOOLEAN NOT NULL DEFAULT true,
  "collectDomains" BOOLEAN NOT NULL DEFAULT true,
  "collectWindowTitles" BOOLEAN NOT NULL DEFAULT false,
  "collectIdle" BOOLEAN NOT NULL DEFAULT true,
  "screenshotsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "screenshotInterval" INTEGER NOT NULL DEFAULT 10,
  "screenshotJitter" INTEGER NOT NULL DEFAULT 20,
  "blurScreenshots" BOOLEAN NOT NULL DEFAULT false,
  "retentionDays" INTEGER NOT NULL DEFAULT 30,
  "allowPrivateMode" BOOLEAN NOT NULL DEFAULT true,
  "excludedApps" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TimeTrackerPolicy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TimeTrackerPolicy_userId_key" ON "TimeTrackerPolicy"("userId");
CREATE INDEX "TimeTrackerPolicy_workspaceId_idx" ON "TimeTrackerPolicy"("workspaceId");
ALTER TABLE "TimeTrackerPolicy" ADD CONSTRAINT "TimeTrackerPolicy_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimeTrackerPolicy" ADD CONSTRAINT "TimeTrackerPolicy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
