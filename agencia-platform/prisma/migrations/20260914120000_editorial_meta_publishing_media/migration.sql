CREATE TABLE "EditorialMediaVersion" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'image',
  "source" TEXT NOT NULL DEFAULT 'generated',
  "url" TEXT NOT NULL,
  "s3Key" TEXT,
  "width" INTEGER,
  "height" INTEGER,
  "prompt" TEXT,
  "metaJson" JSONB,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EditorialMediaVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EditorialMetaProfile" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "metaConnectionId" TEXT,
  "label" TEXT NOT NULL,
  "facebookPageId" TEXT,
  "facebookPageName" TEXT,
  "instagramUserId" TEXT,
  "instagramName" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "lastSyncAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EditorialMetaProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EditorialPublication" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "profileId" TEXT,
  "network" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "scheduledFor" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "externalPostId" TEXT,
  "externalUrl" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EditorialPublication_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EditorialMediaVersion_workspaceId_postId_createdAt_idx" ON "EditorialMediaVersion"("workspaceId", "postId", "createdAt");
CREATE INDEX "EditorialMediaVersion_postId_kind_idx" ON "EditorialMediaVersion"("postId", "kind");

CREATE UNIQUE INDEX "EditorialMetaProfile_workspaceId_clientId_facebookPageId_instagramUserId_key" ON "EditorialMetaProfile"("workspaceId", "clientId", "facebookPageId", "instagramUserId");
CREATE INDEX "EditorialMetaProfile_workspaceId_clientId_active_idx" ON "EditorialMetaProfile"("workspaceId", "clientId", "active");
CREATE INDEX "EditorialMetaProfile_metaConnectionId_idx" ON "EditorialMetaProfile"("metaConnectionId");

CREATE UNIQUE INDEX "EditorialPublication_workspaceId_idempotencyKey_key" ON "EditorialPublication"("workspaceId", "idempotencyKey");
CREATE INDEX "EditorialPublication_workspaceId_status_scheduledFor_idx" ON "EditorialPublication"("workspaceId", "status", "scheduledFor");
CREATE INDEX "EditorialPublication_postId_network_idx" ON "EditorialPublication"("postId", "network");
CREATE INDEX "EditorialPublication_profileId_idx" ON "EditorialPublication"("profileId");

ALTER TABLE "EditorialMediaVersion" ADD CONSTRAINT "EditorialMediaVersion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EditorialMediaVersion" ADD CONSTRAINT "EditorialMediaVersion_postId_fkey" FOREIGN KEY ("postId") REFERENCES "EditorialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EditorialMetaProfile" ADD CONSTRAINT "EditorialMetaProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EditorialMetaProfile" ADD CONSTRAINT "EditorialMetaProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EditorialMetaProfile" ADD CONSTRAINT "EditorialMetaProfile_metaConnectionId_fkey" FOREIGN KEY ("metaConnectionId") REFERENCES "MetaConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EditorialPublication" ADD CONSTRAINT "EditorialPublication_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EditorialPublication" ADD CONSTRAINT "EditorialPublication_postId_fkey" FOREIGN KEY ("postId") REFERENCES "EditorialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EditorialPublication" ADD CONSTRAINT "EditorialPublication_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "EditorialMetaProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
