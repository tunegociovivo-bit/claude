import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { withApi } from "@/lib/api/handler";
import { loadMobileAutomationAccess, requireSerialLinkedToWorkspace } from "@/lib/mobile/automation-access";
import { claimNextMobileAutomationJob } from "@/lib/mobile/automation-jobs";
import { autoResumeStalledThreads } from "@/lib/mobile/thread-resume";
import { failoverBlockedThreadMessages, markDeviceSeen } from "@/lib/mobile/thread-failover";

const claimSchema = z.object({
  deviceSerial: z.string().trim().min(1).max(160),
  executorSessionId: z.string().uuid()
}).strict();

export const POST = withApi({ scope: "*", rate: "mobile_worker" }, async (req, { api }) => {
  const { phones } = await loadMobileAutomationAccess(api.workspaceId, api.userId, { manager: true });
  const parsed = claimSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw new ApiError(400, "validation_error", parsed.error.issues[0]?.message ?? "Claim no válido");
  }
  requireSerialLinkedToWorkspace(phones, parsed.data.deviceSerial);
  markDeviceSeen(api.workspaceId, parsed.data.deviceSerial);
  // Si un móvil bloquea un mensaje de conversación, pasa a otro móvil libre.
  await failoverBlockedThreadMessages(api.workspaceId, phones).catch((error) => {
    console.warn("[mobile] reasignación de mensajes bloqueados falló", error);
  });
  // Las conversaciones paradas se reactivan solas tras un rato sin avances.
  await autoResumeStalledThreads(api.workspaceId).catch((error) => {
    console.warn("[mobile] auto-resume de conversaciones falló", error);
  });
  let blockedReason: string | null = null;
  const job = await claimNextMobileAutomationJob({
    workspaceId: api.workspaceId,
    deviceSerial: parsed.data.deviceSerial,
    executorSessionId: parsed.data.executorSessionId,
    onBlocked: (reason) => { blockedReason = reason; }
  });
  return NextResponse.json({ job, blockedReason });
});

