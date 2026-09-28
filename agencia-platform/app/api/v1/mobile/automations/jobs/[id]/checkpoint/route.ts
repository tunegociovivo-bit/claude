import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { loadMobileAutomationAccess } from "@/lib/mobile/automation-access";
import { MAX_CONVERSATION_BATCH_TEXT, parseConversationBatch } from "@/lib/mobile/facebook-conversations";
import { parsePageFollowBatch, samePageFollowTargets } from "@/lib/mobile/page-follow-batch";
import { parseCommentThreadMessage, serializeCommentThreadMessage } from "@/lib/mobile/comment-thread";

const schema = z.object({ executorSessionId: z.string().uuid(), text: z.string().max(MAX_CONVERSATION_BATCH_TEXT).optional(), sendIntent: z.literal(true).optional() }).strict();
export const POST = withApi({ scope: "*", rate: "mobile_worker" }, async (req, { api, params }) => {
  await loadMobileAutomationAccess(api.workspaceId, api.userId, { manager: true });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", "Progreso no válido.");
  const job = await prisma.mobileAutomationJob.findFirst({ where: { id: params.id, workspaceId: api.workspaceId } });
  const now = new Date();
  if (!job || job.status !== "RUNNING" || !job.leaseUntil || job.leaseUntil <= now || job.leaseOwner !== parsed.data.executorSessionId || !["DISCOVER_FACEBOOK_CONVERSATIONS", "REPLY_FACEBOOK_CONVERSATIONS", "FOLLOW_PAGES", "POST_THREAD_MESSAGE"].includes(job.action)) {
    throw new ApiError(409, "lease_lost", "La ejecución se ha detenido o está en otra pestaña.");
  }
  let intentText: string | undefined;
  if (parsed.data.sendIntent) {
    if (job.action !== "POST_THREAD_MESSAGE" || parsed.data.text) throw new ApiError(400, "invalid_progress", "Intención de envío no válida.");
    const message = parseCommentThreadMessage(job.text ?? "");
    if (["review", "sent"].includes(message.outcome)) throw new ApiError(409, "send_already_started", "Este mensaje ya tiene un envío pendiente de confirmar.");
    intentText = serializeCommentThreadMessage({ ...message, outcome: "review", detail: "Envío iniciado; comprobar antes de volver a publicar." });
  }
  if (parsed.data.text && job.action === "POST_THREAD_MESSAGE") {
    throw new ApiError(400, "invalid_progress", "Los mensajes de conversación no admiten progreso parcial.");
  }
  if (parsed.data.text && job.action === "FOLLOW_PAGES") {
    let same = false;
    try { same = samePageFollowTargets(parsePageFollowBatch(job.text ?? ""), parsePageFollowBatch(parsed.data.text)); } catch { same = false; }
    if (!same) throw new ApiError(400, "invalid_progress", "La lista de páginas no puede cambiar durante la ejecución.");
  } else if (parsed.data.text) {
    const current = parseConversationBatch(job.text ?? "");
    const next = parseConversationBatch(parsed.data.text);
    if (JSON.stringify(current.config) !== JSON.stringify(next.config)) throw new ApiError(400, "invalid_progress", "El alcance no puede cambiar durante la ejecución.");
    if (job.action === "REPLY_FACEBOOK_CONVERSATIONS") {
      const identity = (items: typeof current.candidates) => items.map(({ outcome: _o, detail: _d, ...item }) => item);
      if (JSON.stringify(identity(current.candidates)) !== JSON.stringify(identity(next.candidates))) throw new ApiError(400, "invalid_progress", "Las respuestas aprobadas no pueden cambiar durante el envío.");
    }
  }
  const changed = await prisma.mobileAutomationJob.updateMany({
    where: { id: job.id, workspaceId: api.workspaceId, status: "RUNNING", leaseOwner: parsed.data.executorSessionId, leaseUntil: { gt: now }, ...(intentText ? { text: job.text } : {}) },
    data: { leaseUntil: new Date(now.getTime() + (job.action === "POST_THREAD_MESSAGE" ? 3 : 10) * 60_000), ...(intentText ? { text: intentText, preparedAt: now } : parsed.data.text ? { text: parsed.data.text } : {}) }
  });
  if (changed.count !== 1) throw new ApiError(409, "lease_lost", "La ejecución se ha detenido.");
  return NextResponse.json({ ok: true });
});
