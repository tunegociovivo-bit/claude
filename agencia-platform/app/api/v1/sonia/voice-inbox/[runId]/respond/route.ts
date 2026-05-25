/**
 * POST /api/v1/sonia/voice-inbox/[runId]/respond
 *
 * Recibe la respuesta del usuario (por voz o por escrito) a la pregunta
 * de Sonia "¿quieres que haga estas tareas?" y actúa:
 *   - decision="approve"  → aprueba y EJECUTA todos los drafts PENDING del run.
 *   - decision="reject"   → los descarta.
 *   - reply libre (texto) → Haiku lo clasifica en APROBAR / RECHAZAR / OTRO.
 *       OTRO deja los drafts y anota la instrucción como comentario en la tarea.
 *   - audio (multipart "audio") → se transcribe con Whisper y se trata como reply.
 *
 * Solo admin. Nunca auto-aprueba si la intención es ambigua (default OTRO).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";
import { executeDraft } from "@/lib/ai/nv-ia/execute-draft";
import { transcribeAudioWithWhisper } from "@/lib/ai/openai";
import { getAnthropicForWorkspace } from "@/lib/ai/anthropic";

export const dynamic = "force-dynamic";

type Decision = "approve" | "reject" | "other";

async function classifyReply(workspaceId: string, reply: string): Promise<Decision> {
  const text = reply.trim();
  if (!text) return "other";
  // Atajos obvios sin gastar tokens.
  if (/^(s[ií]|vale|ok|dale|adelante|hazl|h[aá]z|claro|perfecto|venga)/i.test(text)) return "approve";
  if (/^(no|nada|d[ée]jal|para|cancela|olv[ií]d)/i.test(text)) return "reject";
  try {
    const client = await getAnthropicForWorkspace(workspaceId);
    const resp = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 8,
      system: [
        {
          type: "text",
          text:
            "Clasifica la respuesta del usuario sobre si quiere que su asistente ejecute unas tareas propuestas. " +
            "Responde SOLO con una palabra en mayúsculas: APROBAR (quiere que las haga), RECHAZAR (no), u OTRO (otra instrucción o ambiguo)."
        }
      ],
      messages: [{ role: "user", content: text.slice(0, 500) }]
    });
    const out = ((resp.content.find((b: any) => b.type === "text") as any)?.text ?? "").toUpperCase();
    if (out.includes("APROBAR")) return "approve";
    if (out.includes("RECHAZAR")) return "reject";
    return "other";
  } catch {
    return "other";
  }
}

export const POST = withApi({ scope: "*", rate: "destructive" }, async (req, { api, params }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const runId = String((params as any)?.runId ?? "");
  if (!runId) throw new ApiError(400, "bad_request", "runId requerido");

  const run = await prisma.aiAgentRun.findFirst({
    where: { id: runId, workspaceId: api.workspaceId },
    select: { id: true, taskId: true, requesterId: true }
  });
  if (!run) throw new ApiError(404, "not_found", "Llamada no encontrada");
  // Aislamiento: solo quien encargó el run (o runs automáticos sin dueño)
  // puede aprobar/ejecutar sus drafts. No actuar sobre avisos de otro usuario.
  if (run.requesterId && run.requesterId !== api.userId) {
    throw new ApiError(403, "forbidden", "Ese aviso no es tuyo");
  }

  // --- Leer entrada: JSON {decision|reply} o multipart {audio} ---
  let decision: Decision | null = null;
  let reply = "";
  const ctype = req.headers.get("content-type") ?? "";
  if (ctype.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    const audio = form?.get("audio");
    const textField = form?.get("reply");
    if (typeof textField === "string") reply = textField;
    if (audio instanceof Blob && audio.size > 0) {
      reply = await transcribeAudioWithWhisper({
        workspaceId: api.workspaceId,
        audio,
        filename: "respuesta.webm",
        language: "es"
      });
    }
  } else {
    const body = await req.json().catch(() => ({}));
    if (body?.decision === "approve" || body?.decision === "reject") decision = body.decision;
    if (typeof body?.reply === "string") reply = body.reply;
  }

  const intent: Decision = decision ?? (await classifyReply(api.workspaceId, reply));

  const pending = await prisma.aiDraft.findMany({
    where: { workspaceId: api.workspaceId, aiAgentRunId: run.id, status: { in: ["PENDING", "FAILED"] } },
    select: { id: true, title: true }
  });

  if (intent === "approve") {
    const results: { id: string; title: string; ok: boolean; error?: string }[] = [];
    for (const d of pending) {
      const claimed = await prisma.aiDraft.updateMany({
        where: { id: d.id, status: { in: ["PENDING", "FAILED"] } },
        data: { status: "APPROVED", reviewedById: api.userId, reviewedAt: new Date() }
      });
      if (claimed.count === 0) {
        results.push({ id: d.id, title: d.title, ok: false, error: "ya cambiada" });
        continue;
      }
      const r = await executeDraft(d.id);
      results.push({ id: d.id, title: d.title, ok: r.ok, error: r.error });
    }
    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;
    const spoken =
      failCount === 0
        ? `Hecho. Me he encargado de ${okCount === 1 ? "la tarea" : `las ${okCount} tareas`}.`
        : `He hecho ${okCount} de ${results.length}. ${failCount} ${failCount === 1 ? "ha fallado" : "han fallado"}, lo dejo anotado.`;
    return NextResponse.json({ intent, spoken, results });
  }

  if (intent === "reject") {
    await prisma.aiDraft.updateMany({
      where: { id: { in: pending.map((d) => d.id) }, status: { in: ["PENDING", "FAILED"] } },
      data: { status: "REJECTED", reviewedById: api.userId, reviewedAt: new Date(), reviewerNote: reply || "Rechazado por voz" }
    });
    return NextResponse.json({ intent, spoken: "Vale, no hago nada.", results: [] });
  }

  // OTRO: no tocamos los drafts; anotamos la instrucción para seguimiento.
  const aiUserId = api.userId;
  if (reply.trim()) {
    await prisma.comment.create({
      data: {
        workspaceId: api.workspaceId,
        targetType: "TASK",
        targetId: run.taskId,
        authorId: aiUserId!,
        body: `🎙️ Instrucción por voz del usuario sobre las tareas flash:\n\n${reply.trim().slice(0, 4000)}`
      }
    });
  }
  return NextResponse.json({
    intent,
    spoken: "Entendido, lo dejo anotado en la tarea para revisarlo.",
    results: []
  });
});
