-- Publicaciones de creatividad dinámica asignadas a campañas monitorizadas
ALTER TABLE "MetaCommentFeed" ADD COLUMN IF NOT EXISTS "adPostsScannedUntil" TIMESTAMP(3);
ALTER TABLE "MetaCommentFeed" ADD COLUMN IF NOT EXISTS "adPostsBackfillUntil" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "MetaFeedAdPost" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "feedId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "adId" TEXT,
    "matchedBy" TEXT NOT NULL DEFAULT 'text',
    "postCreatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MetaFeedAdPost_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MetaFeedAdPost_feedId_postId_key" ON "MetaFeedAdPost"("feedId", "postId");
CREATE INDEX IF NOT EXISTS "MetaFeedAdPost_workspaceId_idx" ON "MetaFeedAdPost"("workspaceId");

DO $$ BEGIN
  ALTER TABLE "MetaFeedAdPost" ADD CONSTRAINT "MetaFeedAdPost_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "MetaCommentFeed"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
