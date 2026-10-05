import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { humanizeAiError } from "@/lib/ai/errors";
import { requireOwnSite } from "@/lib/seo-blog/access";
import { generateIdeas } from "@/lib/seo-blog/service";
import { num, parseBody, z } from "@/lib/seo-blog/validate";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  n: num.optional(),
  focus: z.string().max(5000).optional(),
  keywordIds: z.array(z.string().max(64)).max(500).optional()
});

export const POST = withApi({ module: "seo", rate: "ai" }, async (req, { params, api }) => {
  const site = await requireOwnSite(api, params.id);
  const b = await parseBody(req, Body);
  try {
    const created = await generateIdeas(api.workspaceId, site.id, {
      n: Number(b.n) || 0,
      focus: String(b.focus ?? "").slice(0, 2000),
      keywordIds: b.keywordIds ?? [],
      userId: api.userId ?? null
    });
    return NextResponse.json({ created });
  } catch (e: any) {
    throw new ApiError(400, "ideas_failed", humanizeAiError(e).message);
  }
});
