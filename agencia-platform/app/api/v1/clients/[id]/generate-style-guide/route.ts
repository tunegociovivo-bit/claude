/**
 * POST /api/v1/clients/[id]/generate-style-guide
 * Regenera la guía de estilo cacheada (styleGuideCached) a partir de las
 * referenceImages del cliente.
 */

import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { generateStyleGuide } from "@/lib/editorial/analyze-client";
import { AIDisabledError } from "@/lib/ai/anthropic";
import { humanizeAiError } from "@/lib/ai/errors";

export const POST = withApi({ scope: "clients:write" }, async (_req, { params, api }) => {
  try {
    const out = await generateStyleGuide({
      workspaceId: api.workspaceId,
      clientId: params.id
    });
    return NextResponse.json(out);
  } catch (e: any) {
    if (e instanceof AIDisabledError) throw new ApiError(503, "ai_disabled", e.message);
    if (e?.message === "Cliente no encontrado") throw new ApiError(404, "not_found", e.message);
    if (e?.message?.startsWith("El cliente no tiene imágenes")) {
      throw new ApiError(400, "no_refs", e.message);
    }
    console.error("[generate-style-guide] error:", e);
    const h = humanizeAiError(e);
    throw new ApiError(500, h.code, h.message);
  }
});
