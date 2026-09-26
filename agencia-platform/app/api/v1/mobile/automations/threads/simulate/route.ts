import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { completeJson } from "@/lib/ai/anthropic";
import { loadMobileAutomationAccess, requireLinkedMobile } from "@/lib/mobile/automation-access";
import { validateAutomationTargetUrl } from "@/lib/mobile/automation-policy";
import {
  MAX_THREAD_MESSAGES,
  MAX_THREAD_PARTICIPANTS,
  normalizeSimulation,
  threadParticipantSchema,
  threadSimulationSystemPrompt,
  threadSimulationUserPrompt
} from "@/lib/mobile/comment-thread";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  postUrl: z.string().trim().min(1).max(2048),
  postContext: z.string().trim().max(1000).default(""),
  guide: z.string().trim().min(10, "Describe brevemente sobre qué deben tratar los comentarios.").max(2000),
  turns: z.number().int().min(2).max(MAX_THREAD_MESSAGES),
  participants: z.array(threadParticipantSchema).min(2, "Selecciona al menos dos móviles.").max(MAX_THREAD_PARTICIPANTS)
}).strict();

/** Genera un borrador de conversación. No crea trabajos ni publica nada. */
export const POST = withApi({ scope: "*", rate: "ai" }, async (req, { api }) => {
  const { phones } = await loadMobileAutomationAccess(api.workspaceId, api.userId, { manager: true });
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.issues[0]?.message ?? "Datos no válidos");
  let postUrl: string;
  try { postUrl = validateAutomationTargetUrl("facebook", parsed.data.postUrl); }
  catch (error) { throw new ApiError(400, "invalid_url", error instanceof Error ? error.message : "URL no válida"); }
  for (const participant of parsed.data.participants) requireLinkedMobile(phones, participant.phoneKey, participant.deviceSerial);

  const output = await completeJson<{ messages?: unknown[] }>({
    workspaceId: api.workspaceId,
    userId: api.userId,
    feature: "mobile_comment_thread_simulation",
    model: "claude-haiku-4-5-20251001",
    system: threadSimulationSystemPrompt(),
    user: threadSimulationUserPrompt({ ...parsed.data, postUrl }),
    schema: {
      type: "object", additionalProperties: false, required: ["messages"],
      properties: { messages: { type: "array", items: {
        type: "object", additionalProperties: false, required: ["participant", "replyToOrder", "text"],
        properties: { participant: { type: "integer" }, replyToOrder: { type: ["integer", "null"] }, text: { type: "string" } }
      } } }
    },
    maxTokens: 4000
  });
  const messages = normalizeSimulation(output, parsed.data.participants.length).slice(0, parsed.data.turns);
  if (messages.length < 2) throw new ApiError(502, "empty_simulation", "La IA no ha generado una conversación válida. Vuelve a intentarlo.");
  return NextResponse.json({ ok: true, postUrl, messages });
});
