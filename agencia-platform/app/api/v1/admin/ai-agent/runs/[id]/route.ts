import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const run = await prisma.aiAgentRun.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  if (!run) throw new ApiError(404, "not_found", "Run no encontrado");
  return NextResponse.json(run);
});
