import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { analyzeCompetitors } from "@/lib/editorial/analyze-competitors";
import { AIDisabledError } from "@/lib/ai/anthropic";

export const POST = withApi({ scope: "*" }, async (_req, { params, api }) => {
  try {
    const out = await analyzeCompetitors({ workspaceId: api.workspaceId, clientId: params.id });
    return NextResponse.json(out);
  } catch (e: any) {
    if (e instanceof AIDisabledError) throw new ApiError(503, "ai_disabled", e.message);
    if (e?.message === "Cliente no encontrado") throw new ApiError(404, "not_found", e.message);
    console.error("[analyze-competitors] error:", e);
    throw new ApiError(500, "ai_error", e?.message ?? "Error analizando");
  }
});
