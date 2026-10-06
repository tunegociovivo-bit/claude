import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { analyzeCompetitors } from "@/lib/editorial/analyze-competitors";
import { AIDisabledError } from "@/lib/ai/anthropic";
import { humanizeAiError } from "@/lib/ai/errors";
import { ensureContentBrand } from "@/lib/content/brand";

export const dynamic = "force-dynamic";

/** Análisis de competencia de la marca. Portado de clients/[id]/analyze-competitors. */
export const POST = withApi({ module: "editorial", rate: "ai" }, async (_req, { api }) => {
  const brand = await ensureContentBrand(api.workspaceId);
  try {
    const out = await analyzeCompetitors({ workspaceId: api.workspaceId, clientId: brand.id });
    return NextResponse.json(out);
  } catch (e: any) {
    if (e instanceof AIDisabledError) throw new ApiError(503, "ai_disabled", e.message);
    if (e?.message === "Ficha de marca no encontrada") throw new ApiError(404, "not_found", e.message);
    console.error("[analyze-competitors] error:", e);
    const h = humanizeAiError(e);
    throw new ApiError(500, h.code, h.message);
  }
});
