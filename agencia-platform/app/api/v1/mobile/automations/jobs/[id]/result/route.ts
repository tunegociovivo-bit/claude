import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { withApi } from "@/lib/api/handler";
import { loadMobileAutomationAccess } from "@/lib/mobile/automation-access";
import { reportMobileAutomationResult } from "@/lib/mobile/automation-jobs";

const resultSchema = z.object({
  executorSessionId: z.string().uuid(),
  outcome: z.enum(["PREPARED", "FAILED"]),
  errorCode: z.string().trim().max(120).optional(),
  error: z.string().trim().max(1000).optional()
}).strict();

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
    errorCode: parsed.data.errorCode,
    error: parsed.data.error
  });
  return NextResponse.json({ ok: true, job });
});

