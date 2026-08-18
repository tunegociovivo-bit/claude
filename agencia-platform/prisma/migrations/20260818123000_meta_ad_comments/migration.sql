CREATE TABLE "MetaCommentFeed" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "clientName" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  "lastSyncAt" TIMESTAMP(3), "lastError" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "MetaCommentFeed_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "MetaAdComment" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "feedId" TEXT NOT NULL,
  "externalCommentId" TEXT NOT NULL, "postId" TEXT, "adId" TEXT, "adName" TEXT,
  "authorName" TEXT, "authorId" TEXT, "message" TEXT NOT NULL,
  "sentiment" TEXT NOT NULL DEFAULT 'neutral', "sentimentReason" TEXT, "aiDraft" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending', "repliedAt" TIMESTAMP(3), "externalReplyId" TEXT,
  "commentCreatedAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "MetaAdComment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MetaCommentFeed_workspaceId_campaignId_key" ON "MetaCommentFeed"("workspaceId", "campaignId");
CREATE INDEX "MetaCommentFeed_workspaceId_active_idx" ON "MetaCommentFeed"("workspaceId", "active");
CREATE UNIQUE INDEX "MetaAdComment_workspaceId_externalCommentId_key" ON "MetaAdComment"("workspaceId", "externalCommentId");
CREATE INDEX "MetaAdComment_workspaceId_sentiment_status_idx" ON "MetaAdComment"("workspaceId", "sentiment", "status");
CREATE INDEX "MetaAdComment_feedId_commentCreatedAt_idx" ON "MetaAdComment"("feedId", "commentCreatedAt");
ALTER TABLE "MetaCommentFeed" ADD CONSTRAINT "MetaCommentFeed_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MetaAdComment" ADD CONSTRAINT "MetaAdComment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MetaAdComment" ADD CONSTRAINT "MetaAdComment_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "MetaCommentFeed"("id") ON DELETE CASCADE ON UPDATE CASCADE;
