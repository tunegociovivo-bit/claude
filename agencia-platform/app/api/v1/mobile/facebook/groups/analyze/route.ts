import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { withApi } from "@/lib/api/handler";
import { completeJson } from "@/lib/ai/anthropic";
import { loadMobileAutomationAccess, requireLinkedMobile } from "@/lib/mobile/automation-access";
import { parseImageDataUrl } from "@/lib/mobile/conversation-radar";
import {
  buildFacebookGroupAnalysisPrompt,
  facebookGroupAnalysisOutputJsonSchema,
  facebookGroupAnalysisRequestSchema
} from "@/lib/mobile/facebook-group-analysis";
import { normalizeFacebookGroupCandidates } from "@/lib/mobile/facebook-group-batch";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*", rate: "ai" }, async (req, { api }) => {
  const parsed = facebookGroupAnalysisRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw new ApiError(400, "validation_error", parsed.error.issues[0]?.message ?? "La búsqueda no es válida");
  }
  const { phones } = await loadMobileAutomationAccess(api.workspaceId, api.userId, { manager: true });
  requireLinkedMobile(phones, parsed.data.phoneKey, parsed.data.deviceSerial);
  const images = parsed.data.screenImages.map(parseImageDataUrl);

  let output: { candidates?: unknown[] };
  try {
    output = await completeJson<{ candidates?: unknown[] }>({
      workspaceId: api.workspaceId,
      userId: api.userId,
      feature: "mobile_facebook_group_discovery",
      model: "claude-haiku-4-5-20251001",
      system: buildFacebookGroupAnalysisPrompt(parsed.data),
      user: "Compara todos los resultados visibles y devuelve el lote estructurado.",
      schema: facebookGroupAnalysisOutputJsonSchema,
      inlineImages: images.map((image) => ({ mediaType: image.mediaType, data: image.data })),
      maxTokens: 4000
    });
  } catch {
    throw new ApiError(
      502,
      "facebook_group_analysis_failed",
      "La IA no ha podido analizar los grupos visibles. Inténtalo de nuevo."
    );
  }

  return NextResponse.json({
    ok: true,
    ephemeral: true,
    candidates: normalizeFacebookGroupCandidates(output.candidates, parsed.data.maxGroups)
  });
});
