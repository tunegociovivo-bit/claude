import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 100);
  const items = await prisma.aiAgentRun.findMany({
    where: { workspaceId: api.workspaceId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      taskId: true,
      status: true,
      model: true,
      summary: true,
      error: true,
      stepsCount: true,
      inputTokens: true,
      outputTokens: true,
      startedAt: true,
      finishedAt: true,
      createdAt: true
    }
  });
  return NextResponse.json({ items });
});
