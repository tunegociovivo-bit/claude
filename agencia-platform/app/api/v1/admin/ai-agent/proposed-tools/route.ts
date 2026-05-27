/**
 * GET /api/v1/admin/ai-agent/proposed-tools
 * POST /api/v1/admin/ai-agent/proposed-tools/:id/review
 *      body: { status: "APPROVED" | "REJECTED" | "IMPLEMENTED", note?: string, implementationRef?: string }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const items = await prisma.aiProposedTool.findMany({
    where: { workspaceId: api.workspaceId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  return NextResponse.json({ items });
});
