ALTER TABLE "MetaAdComment"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "authorBlockedAt" TIMESTAMP(3);
