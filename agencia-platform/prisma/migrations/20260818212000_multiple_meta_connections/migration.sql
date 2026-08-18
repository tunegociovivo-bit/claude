DROP INDEX IF EXISTS "MetaConnection_userId_workspaceId_key";
ALTER TABLE "MetaConnection" ADD COLUMN "displayName" TEXT;
DELETE FROM "MetaConnection" older USING "MetaConnection" newer
WHERE older."workspaceId" = newer."workspaceId"
  AND older."metaUserId" IS NOT NULL
  AND older."metaUserId" = newer."metaUserId"
  AND (older."updatedAt", older."id") < (newer."updatedAt", newer."id");
CREATE UNIQUE INDEX "MetaConnection_workspaceId_metaUserId_key" ON "MetaConnection"("workspaceId", "metaUserId");

ALTER TABLE "MetaCommentFeed" ADD COLUMN "metaConnectionId" TEXT;
CREATE INDEX "MetaCommentFeed_metaConnectionId_idx" ON "MetaCommentFeed"("metaConnectionId");
ALTER TABLE "MetaCommentFeed" ADD CONSTRAINT "MetaCommentFeed_metaConnectionId_fkey" FOREIGN KEY ("metaConnectionId") REFERENCES "MetaConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
