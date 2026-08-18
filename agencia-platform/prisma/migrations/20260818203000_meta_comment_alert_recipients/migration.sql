CREATE TABLE "MetaCommentAlertRecipient" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "negativeComments" BOOLEAN NOT NULL DEFAULT true,
    "allComments" BOOLEAN NOT NULL DEFAULT false,
    "syncFailures" BOOLEAN NOT NULL DEFAULT false,
    "publishedReplies" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaCommentAlertRecipient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MetaCommentAlertRecipient_workspaceId_email_key" ON "MetaCommentAlertRecipient"("workspaceId", "email");
CREATE INDEX "MetaCommentAlertRecipient_workspaceId_active_idx" ON "MetaCommentAlertRecipient"("workspaceId", "active");

ALTER TABLE "MetaCommentAlertRecipient" ADD CONSTRAINT "MetaCommentAlertRecipient_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
