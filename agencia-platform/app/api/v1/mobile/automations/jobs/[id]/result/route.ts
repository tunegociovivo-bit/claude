import { MAX_CONVERSATION_BATCH_TEXT, parseConversationBatch } from "@/lib/mobile/facebook-conversations";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { withApi } from "@/lib/api/handler";
import { loadMobileAutomationAccess } from "@/lib/mobile/automation-access";
import { reportMobileAutomationResult } from "@/lib/mobile/automation-jobs";
import {
  MAX_FACEBOOK_GROUP_BATCH_TEXT,
  parseFacebookGroupBatch
} from "@/lib/mobile/facebook-group-batch";

const resultSchema = z.object({
  executorSessionId: z.string().uuid(),
  outcome: z.enum(["PREPARED", "DISCOVERED", "COMPLETED", "PARTIAL", "FAILED"]),
  resultText: z.string().trim().min(1).max(MAX_CONVERSATION_BATCH_TEXT).optional(),
  errorCode: z.string().trim().max(120).optional(),
  error: z.string().trim().max(1000).optional()
}).strict().superRefine((value, context) => {
  if (!["DISCOVERED", "COMPLETED", "PARTIAL"].includes(value.outcome)) return;
  if (!value.resultText) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["resultText"], message: "Falta el resultado del lote" });
    return;
  }
  try {
    if (JSON.parse(value.resultText)?.kind === "facebook_conversations") parseConversationBatch(value.resultText);
    else parseFacebookGroupBatch(value.resultText);
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["resultText"],
      message: error instanceof Error ? error.message : "El lote no es válido"
    });
  }
});

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api, params }) => {
  await loadMobileAutomationAccess(api.workspaceId, api.userId, { manager: true });
  const parsed = resultSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw new ApiError(400, "validation_error", parsed.error.issues[0]?.message ?? "Resultado no válido");
  }
  const job = await reportMobileAutomationResult({
    workspaceId: api.workspaceId,
    jobId: params.id,
    executorSessionId: parsed.data.executorSessionId,
    outcome: parsed.data.outcome,
    resultText: parsed.data.resultText,
    errorCode: parsed.data.errorCode,
    error: parsed.data.error
  });
  return NextResponse.json({ ok: true, job });
});
