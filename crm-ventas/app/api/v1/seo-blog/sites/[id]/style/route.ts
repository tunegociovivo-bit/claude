import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { humanizeAiError } from "@/lib/ai/errors";
import { requireOwnSite } from "@/lib/seo-blog/access";
import { analyzeStyle } from "@/lib/seo-blog/service";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export const POST = withApi({ module: "seo", rate: "ai" }, async (_req, { params, api }) => {
  const site = await requireOwnSite(api, params.id);
  try {
    return NextResponse.json(await analyzeStyle(api.workspaceId, site.id, api.userId));
  } catch (e: any) {
    throw new ApiError(400, "style_failed", humanizeAiError(e).message);
  }
});
