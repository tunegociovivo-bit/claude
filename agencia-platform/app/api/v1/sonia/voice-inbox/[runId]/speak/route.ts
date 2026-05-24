/**
 * GET /api/v1/sonia/voice-inbox/[runId]/speak
 *
 * Devuelve un MP3 con Sonia diciendo qué puede hacer a raíz de la
 * llamada (los AiDraft PENDING del run). Lo reproduce el notificador.
 *
 * 204 si ElevenLabs no está configurado → el cliente cae a la voz del
 * navegador con el texto que recibe de /voice-inbox.
 *
 * Solo admin.h
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";
import { elevenlabsSynthesize } from "@/lib/integrations/elevenlabs";

export const dynamic = "force-dynamic";

function firstNameOf(name: string | null, email: string | null): string | null {
  if (name && name.trim()) {
    const first = name.trim().split(/\s+/)[0];
    if (first.length >= 2) return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  }
  if (email) {
    const local = email.split("@")[0]?.split(/[.\-_]/)?.[0];
    if (local && local.length >= 2) return local.charAt(0).toUpperCase() + local.slice(1).toLowerCase();
  }
  return null;
}

function clean(s: string): string {
  return s
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/[✅✔️❌⚠️⛔🚨🔍📎📊📍💡🎙🔔🔕📞📧⚡🤖]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildVoiceInboxSpeech(opts: {
  userFirstName: string | null;
  taskTitle: string | null;
  draftTitles: string[];
}): string {
  const greet = opts.userFirstName ? `${opts.userFirstName}, ` : "";
  const titles = opts.draftTitles.map(clean).filter(Boolean);
  const list =
    titles.length === 1
      ? titles[0]
      : titles.slice(0, -1).join(", ") + " y " + titles[titles.length - 1];
  const intro = clean(opts.taskTitle ?? "una llamada");
  return clean(
    `${greet}he procesado ${intro}. Puedo encargarme de ${titles.length === 1 ? "esto" : "estas cosas"}: ${list}. ` +
      `¿Quieres que las haga? Dímelo por voz o por escrito.`
  ).slice(0, 800);
}

export const GET = withApi({ scope: "*" }, async (_req, { api, params }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const runId = String((params as any)?.runId ?? "");
  if (!runId) throw new ApiError(400, "bad_request", "runId requerido");

  const run = await prisma.aiAgentRun.findFirst({
    where: { id: runId, workspaceId: api.workspaceId },
    select: { id: true, taskId: true }
  });
  if (!run) throw new ApiError(404, "not_found", "Llamada no encontrada");

  const drafts = await prisma.aiDraft.findMany({
    where: { workspaceId: api.workspaceId, aiAgentRunId: run.id, status: "PENDING" },
    select: { title: true },
    orderBy: { createdAt: "asc" }
  });
  if (drafts.length === 0) return new NextResponse(null, { status: 204 });

  const task = await prisma.task.findFirst({
    where: { id: run.taskId, workspaceId: api.workspaceId },
    select: { title: true }
  });

  let userFirstName: string | null = null;
  if (api.userId) {
    const u = await prisma.user.findUnique({
      where: { id: api.userId },
      select: { name: true, email: true }
    });
    userFirstName = firstNameOf(u?.name ?? null, u?.email ?? null);
  }

  const text = buildVoiceInboxSpeech({
    userFirstName,
    taskTitle: task?.title ?? null,
    draftTitles: drafts.map((d) => d.title)
  });

  try {
    const mp3 = await elevenlabsSynthesize({ workspaceId: api.workspaceId, text });
    return new NextResponse(mp3 as any, {
      status: 200,
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" }
    });
  } catch {
    // ElevenLabs no configurado o error → 204, el cliente usa TTS del navegador.
    return new NextResponse(null, { status: 204 });
  }
});
