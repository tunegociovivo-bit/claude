/**
 * POST /api/v1/brand/generate-style-guide
 * Regenera la guía de estilo cacheada (styleGuideCached) a partir de las
 * referenceImages de la marca. Portado de clients/[id]/generate-style-guide.
 */

import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { generateStyleGuide } from "@/lib/editorial/analyze-client";
import { AIDisabledError } from "@/lib/ai/anthropic";
import { humanizeAiError } from "@/lib/ai/errors";
import { ensureContentBrand } from "@/lib/content/brand";

export const dynamic = "force-dynamic";

export const POST = withApi({ module: "editorial", rate: "ai" }, async (_req, { api }) => {
  const brand = await ensureContentBrand(api.workspaceId);
  try {
    const out = await generateStyleGuide({
      workspaceId: api.workspaceId,
      clientId: brand.id
    });
    return NextResponse.json(out);
  } catch (e: any) {
    if (e instanceof AIDisabledError) throw new ApiError(503, "ai_disabled", e.message);
    if (e?.message === "Ficha de marca no encontrada") throw new ApiError(404, "not_found", e.message);
    if (e?.message?.startsWith("Tu marca no tiene imágenes")) {
      throw new ApiError(400, "no_refs", e.message);
    }
    console.error("[generate-style-guide] error:", e);
    const h = humanizeAiError(e);
    throw new ApiError(500, h.code, h.message);
  }
});
