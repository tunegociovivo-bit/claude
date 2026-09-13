import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { withApi } from "@/lib/api/handler";
import { completeJson } from "@/lib/ai/anthropic";
import { loadMobileAutomationAccess, requireLinkedMobile } from "@/lib/mobile/automation-access";
import {
  buildFacebookGroupAnswersPrompt,
  facebookGroupAnswersOutputJsonSchema,
  facebookGroupAnswersRequestSchema,
  normalizeFacebookGroupAnswers
} from "@/lib/mobile/facebook-group-analysis";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*", rate: "ai" }, async (req, { api }) => {
  const parsed = facebookGroupAnswersRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw new ApiError(400, "validation_error", parsed.error.issues[0]?.message ?? "Las preguntas no son válidas");
  }
  const { phones } = await loadMobileAutomationAccess(api.workspaceId, api.userId, { manager: true });
  requireLinkedMobile(phones, parsed.data.phoneKey, parsed.data.deviceSerial);
  const prompt = buildFacebookGroupAnswersPrompt(parsed.data);

  let output: { answers?: unknown[] };
  try {
    output = await completeJson<{ answers?: unknown[] }>({
      workspaceId: api.workspaceId,
      userId: api.userId,
      feature: "mobile_facebook_group_answers",
      model: "claude-haiku-4-5-20251001",
      system: prompt.system,
      user: prompt.user,
      schema: facebookGroupAnswersOutputJsonSchema,
      maxTokens: 1800
    });
  } catch {
    throw new ApiError(
      502,
      "facebook_group_answers_failed",
      "La IA no ha podido preparar las respuestas de acceso."
    );
  }

  return NextResponse.json({
    ok: true,
    answers: normalizeFacebookGroupAnswers(output.answers, parsed.data.questions.length)
  });
});
