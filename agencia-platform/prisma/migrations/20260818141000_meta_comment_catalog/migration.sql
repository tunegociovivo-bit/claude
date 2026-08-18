ALTER TABLE "MetaCommentFeed"
  ADD COLUMN "campaignName" TEXT,
  ADD COLUMN "adAccountId" TEXT,
  ADD COLUMN "adAccountName" TEXT;

ALTER TABLE "MetaAdComment"
  ADD COLUMN "platform" TEXT NOT NULL DEFAULT 'facebook';
