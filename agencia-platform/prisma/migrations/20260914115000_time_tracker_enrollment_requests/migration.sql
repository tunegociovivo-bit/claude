CREATE TABLE "TimeTrackerEnrollmentRequest" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requesterName" TEXT NOT NULL,
    "requesterEmail" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "approvalTokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "selectedUserId" TEXT,
    "codePrefix" TEXT,
    "codeHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "codeExpiresAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TimeTrackerEnrollmentRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TimeTrackerEnrollmentRequest_approvalTokenHash_key" ON "TimeTrackerEnrollmentRequest"("approvalTokenHash");
CREATE UNIQUE INDEX "TimeTrackerEnrollmentRequest_requestKey_key" ON "TimeTrackerEnrollmentRequest"("requestKey");
CREATE UNIQUE INDEX "TimeTrackerEnrollmentRequest_codePrefix_key" ON "TimeTrackerEnrollmentRequest"("codePrefix");
CREATE INDEX "TimeTrackerEnrollmentRequest_workspaceId_status_createdAt_idx" ON "TimeTrackerEnrollmentRequest"("workspaceId", "status", "createdAt");
CREATE INDEX "TimeTrackerEnrollmentRequest_requesterEmail_deviceId_createdAt_idx" ON "TimeTrackerEnrollmentRequest"("requesterEmail", "deviceId", "createdAt");
