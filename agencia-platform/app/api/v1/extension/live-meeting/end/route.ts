/**
 * POST /api/v1/extension/live-meeting/end
 * body: { sessionId, projectId?, status? }
 *
 * Finaliza la sesión. Resume el transcript con Claude, extrae action
 * items, y crea una task en el proyecto destino (default: primer
 * proyecto vivo del workspace) con todo el contexto. Marca la
 * LiveMeetingSession como ENDED y enlaza taskId.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { completeJson } from "@/lib/ai/anthropic";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({
  sessionId: z.string(),
  projectId: z.string().optional(),
  status: z.string().optional()
});

const SUMMARY_SYSTEM = `Eres un resumidor de reuniones. Te paso un transcript en castellano y debes devolver JSON con: title (titular sin frases hechas, max 80 chars), summary (3-6 frases), actionItems (lista de strings, cada uno una acción accionable), participants (nombres mencionados), keyDecisions (decisiones acordadas). No inventes nada — solo lo que está en el transcript.`;

const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    actionItems: { type: "array", items: { type: "string" } },
    participants: { type: "array", items: { type: "string" } },
    keyDecisions: { type: "array", items: { type: "string" } }
  },
  required: ["title", "summary", "actionItems"]
};

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const session = await prisma.liveMeetingSession.findFirst({
    where: { id: parsed.data.sessionId, workspaceId: api.workspaceId }
  });
  if (!session) throw new ApiError(404, "not_found", "Sesión no encontrada");

  // Resolver proyecto destino
  let projectId: string;
  if (parsed.data.projectId) {
    const p = await prisma.project.findFirst({
      where: { id: parsed.data.projectId, workspaceId: api.workspaceId, deletedAt: null } as any
    });
    if (!p) throw new ApiError(400, "bad_project", "projectId inválido");
    projectId = p.id;
  } else {
    const first = await prisma.project.findFirst({
      where: { workspaceId: api.workspaceId, deletedAt: null, archived: false } as any,
      orderBy: { createdAt: "asc" }
    });
    if (!first) throw new ApiError(500, "no_project", "No hay proyectos donde crear la task");
    projectId = first.id;
  }

  // Resumir con Claude (si hay transcript no trivial)
  let summary: any = {
    title: session.meetingTitle ?? `Reunión ${new Date().toLocaleDateString("es-ES")}`,
    summary: "(sin transcripción)",
    actionItems: [],
    participants: [],
    keyDecisions: []
  };
  if (session.fullTranscript && session.fullTranscript.length > 50) {
    try {
      summary = await completeJson<any>({
        workspaceId: api.workspaceId,
        system: SUMMARY_SYSTEM,
        user: `Transcript:\n\n${session.fullTranscript.slice(0, 30000)}`,
        schema: SUMMARY_SCHEMA,
        maxTokens: 2000
      });
    } catch (e: any) {
      summary.summary = `Resumen no disponible (${e?.message ?? e}). Transcripción completa abajo.`;
    }
  }

  // Crear task
  const allSuggestions = (session.suggestionsLog as any[])?.flatMap(
    (e: any) => e?.suggestions ?? []
  ) ?? [];
  const description =
    `**${summary.title}**\n\n` +
    `${summary.summary}\n\n` +
    (summary.actionItems?.length
      ? `**Action items:**\n${summary.actionItems.map((a: string) => `- ${a}`).join("\n")}\n\n`
      : "") +
    (summary.keyDecisions?.length
      ? `**Decisiones:**\n${summary.keyDecisions.map((d: string) => `- ${d}`).join("\n")}\n\n`
      : "") +
    (summary.participants?.length
      ? `**Participantes mencionados:** ${summary.participants.join(", ")}\n\n`
      : "") +
    (allSuggestions.length
      ? `**Sugerencias Sonia en vivo (${allSuggestions.length}):**\n${allSuggestions
          .map((s: any) => `- [${s.type}] ${s.title}${s.body ? ` — ${s.body}` : ""}`)
          .join("\n")}\n\n`
      : "") +
    `**Transcripción completa:**\n\n${session.fullTranscript.slice(0, 16000)}` +
    (session.fullTranscript.length > 16000 ? "\n\n...(truncada)" : "");

  const task = await prisma.task.create({
    data: {
      workspaceId: api.workspaceId,
      projectId,
      title: String(summary.title ?? "Reunión").slice(0, 200),
      description,
      status: parsed.data.status ?? "TODO",
      priority: "MEDIUM",
      assignees: { create: [{ userId: api.userId }] }
    }
  });

  await prisma.liveMeetingSession.update({
    where: { id: session.id },
    data: {
      status: "ENDED",
      endedAt: new Date(),
      taskId: task.id
    }
  });

  return NextResponse.json({
    ok: true,
    taskId: task.id,
    actionItems: summary.actionItems?.length ?? 0,
    suggestionsCount: allSuggestions.length
  });
});
