import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { withApi } from "@/lib/api/handler";
import { loadMobileAutomationAccess, requireSerialLinkedToWorkspace } from "@/lib/mobile/automation-access";
import { claimNextMobileAutomationJob } from "@/lib/mobile/automation-jobs";

const claimSchema = z.object({
  deviceSerial: z.string().trim().min(1).max(160),
  executorSessionId: z.string().uuid()
}).strict();

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  const { phones } = await loadMobileAutomationAccess(api.workspaceId, api.userId, { manager: true });
  const parsed = claimSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw new ApiError(400, "validation_error", parsed.error.issues[0]?.message ?? "Claim no válido");
  }
  requireSerialLinkedToWorkspace(phones, parsed.data.deviceSerial);
  const job = await claimNextMobileAutomationJob({
    workspaceId: api.workspaceId,
    deviceSerial: parsed.data.deviceSerial,
    executorSessionId: parsed.data.executorSessionId
  });
  return NextResponse.json({ job });
});

