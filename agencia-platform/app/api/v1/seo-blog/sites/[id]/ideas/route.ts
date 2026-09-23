import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireSeoBlogAccess } from "@/lib/seo-blog/access";
import { generateIdeas } from "@/lib/seo-blog/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = withApi({ scope: "*", rate: "ai" }, async (req, { params, api }) => {
  await requireSeoBlogAccess(api);
  const site = await prisma.seoBlogSite.findFirst({ where: { id: params.id, workspaceId: api.workspaceId }, select: { id: true } });
  if (!site) throw new ApiError(404, "not_found", "No encontrado");
  const b = (await req.json().catch(() => ({}))) ?? {};
  try {
    const created = await generateIdeas(api.workspaceId, site.id, {
      n: Number(b.n) || 0,
      focus: String(b.focus ?? "").slice(0, 2000),
      keywordIds: Array.isArray(b.keywordIds) ? b.keywordIds.map(String) : [],
      userId: api.userId ?? null
    });
    return NextResponse.json({ created });
  } catch (e: any) {
    throw new ApiError(400, "ideas_failed", e?.message ?? String(e));
  }
});
