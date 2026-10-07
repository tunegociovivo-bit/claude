-- CreateTable
CREATE TABLE IF NOT EXISTS "GmbReviewFunnel" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "clientId" TEXT NOT NULL DEFAULT '',
    "businessName" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "rating" DOUBLE PRECISION,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "mapsUrl" TEXT NOT NULL DEFAULT '',
    "reviewUrl" TEXT NOT NULL,
    "ownerEmail" TEXT NOT NULL DEFAULT '',
    "headline" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT '#F4600C',
    "logoUrl" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmbReviewFunnel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "GmbReviewFunnelEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "funnelId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "stars" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GmbReviewFunnelEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "GmbReviewFunnelFeedback" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "funnelId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL,
    "emailed" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GmbReviewFunnelFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "GmbReviewFunnel_slug_key" ON "GmbReviewFunnel"("slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GmbReviewFunnel_workspaceId_idx" ON "GmbReviewFunnel"("workspaceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GmbReviewFunnelEvent_workspaceId_idx" ON "GmbReviewFunnelEvent"("workspaceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GmbReviewFunnelEvent_funnelId_type_idx" ON "GmbReviewFunnelEvent"("funnelId", "type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GmbReviewFunnelFeedback_workspaceId_idx" ON "GmbReviewFunnelFeedback"("workspaceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GmbReviewFunnelFeedback_funnelId_idx" ON "GmbReviewFunnelFeedback"("funnelId");

