import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { withApi } from "@/lib/api/handler";
import { completeJson } from "@/lib/ai/anthropic";
import { loadMobileAutomationAccess, requireLinkedMobile } from "@/lib/mobile/automation-access";
import {
  buildConversationRadarSystemPrompt,
  conversationRadarOutputJsonSchema,
  conversationRadarRequestSchema,
  normalizeConversationCandidates,
  parseImageDataUrl
} from "@/lib/mobile/conversation-radar";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*", rate: "ai" }, async (req, { api }) => {
  const parsed = conversationRadarRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw new ApiError(
      400,
      "validation_error",
      parsed.error.issues[0]?.message ?? "La solicitud del radar no es válida"
    );
  }

  const { phones } = await loadMobileAutomationAccess(api.workspaceId, api.userId, { manager: true });
  requireLinkedMobile(phones, parsed.data.phoneKey, parsed.data.deviceSerial);

  const image = parseImageDataUrl(parsed.data.screenImage);
  let output: { candidates?: unknown[] };
  try {
    output = await completeJson<{ candidates?: unknown[] }>({
      workspaceId: api.workspaceId,
      userId: api.userId,
      feature: "mobile_conversation_radar",
      model: "claude-haiku-4-5-20251001",
      system: buildConversationRadarSystemPrompt(parsed.data.rule),
      user: "Identifica los comentarios relevantes de la pantalla adjunta y devuelve únicamente el resultado estructurado.",
      schema: conversationRadarOutputJsonSchema,
      inlineImages: [{ mediaType: image.mediaType, data: image.data }],
      maxTokens: 3000
    });
  } catch {
    // El proveedor puede incluir texto reconocido en el error. Lo sustituimos
    // antes de llegar al logger global para mantener efímera la captura.
    throw new ApiError(
      502,
      "conversation_analysis_failed",
      "La IA no ha podido analizar esta pantalla. Inténtalo de nuevo con los comentarios más visibles."
    );
  }

  const candidates = normalizeConversationCandidates(
    output?.candidates,
    parsed.data.rule.minimumRelevance
  );

  return NextResponse.json({ ok: true, ephemeral: true, candidates });
});
