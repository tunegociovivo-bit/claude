import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireSeoBlogAccess } from "@/lib/seo-blog/access";
import { analyzeStyle } from "@/lib/seo-blog/service";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export const POST = withApi({ scope: "*", rate: "ai" }, async (_req, { params, api }) => {
  await requireSeoBlogAccess(api);
  const site = await prisma.seoBlogSite.findFirst({ where: { id: params.id, workspaceId: api.workspaceId }, select: { id: true } });
  if (!site) throw new ApiError(404, "not_found", "No encontrado");
  try {
    return NextResponse.json(await analyzeStyle(api.workspaceId, site.id, api.userId));
  } catch (e: any) {
    throw new ApiError(400, "style_failed", e?.message ?? String(e));
  }
});
