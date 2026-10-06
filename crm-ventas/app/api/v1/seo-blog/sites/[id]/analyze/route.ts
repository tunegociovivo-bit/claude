/**
 * POST /api/v1/seo-blog/sites/:id/analyze  { url }
 * «Analizar con IA» de Ajustes → Negocio y voz: lee la web del negocio, rellena
 * y guarda los campos, y devuelve la ficha actualizada.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { AIDisabledError } from "@/lib/ai/anthropic";
import { humanizeAiError } from "@/lib/ai/errors";
import { requireOwnSite, siteOut } from "@/lib/seo-blog/access";
import { analyzeBusinessAndSave, BusinessSiteError } from "@/lib/seo-blog/analyze-business";
import { parseBody, z } from "@/lib/seo-blog/validate";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const Body = z.object({ url: z.string().max(500).optional() });

export const POST = withApi({ module: "seo", rate: "ai" }, async (req, { params, api }) => {
  const site = await requireOwnSite(api, params.id);
  const b = await parseBody(req, Body);
  const url = (b.url ?? "").trim() || site.siteUrl;
  try {
    const result = await analyzeBusinessAndSave({ workspaceId: api.workspaceId, siteId: site.id, userId: api.userId, url });
    const fresh = await prisma.seoBlogSite.findFirst({ where: { id: site.id, workspaceId: api.workspaceId }, include: { client: { select: { name: true } } } });
    if (!fresh) throw new ApiError(404, "not_found", "No encontrado");
    return NextResponse.json({ ...result, site: siteOut(fresh) });
  } catch (e: any) {
    if (e instanceof ApiError) throw e;
    if (e instanceof BusinessSiteError) throw new ApiError(400, "website_unreachable", e.message);
    if (e instanceof AIDisabledError) throw new ApiError(503, "ai_disabled", e.message);
    console.error("[seo-blog/analyze] error:", e);
    const h = humanizeAiError(e);
    throw new ApiError(500, h.code, h.message);
  }
});
