/**
 * POST /api/v1/extension/upload-recording
 *
 * Endpoint consumido por la extensión de Chrome "Hub Reuniones".
 * Recibe un blob de audio (webm/opus típicamente) capturado de la
 * pestaña de la reunión, lo transcribe con Whisper, lo resume con
 * Claude (reusando el flow ya probado de MeetingRecorder) y crea
 * una tarea en /tareas con el resumen como descripción + comentario.
 *
 * Auth: SIEMPRE por API key (Bearer ag_…). La extensión no puede
 * usar la cookie de NextAuth porque vive en otro origen y los
 * service workers/offscreen no comparten cookies httpOnly. El user
 * configura la key una vez en el popup desde /admin/api-keys.
 *
 * Multipart:
 *   audio          (Blob, webm)
 *   meetingUrl     (string, p.ej. https://meet.google.com/abc-defg-hij)
 *   meetingTitle   (string, título de la tab)
 *   durationMs     (string, aproximada)
 *
 * Respuesta: { taskId, taskUrl, taskTitle, summaryPreview }
 *
 * Errores: 401 sin api key, 413 audio > 25MB (límite Whisper),
 * 503 si ai_disabled.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { transcribeAudioWithWhisper } from "@/lib/ai/openai";
import { completeJson } from "@/lib/ai/anthropic";
import { auditFromReq } from "@/lib/audit/log";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5min — Whisper + Claude pueden tardar
export const runtime = "nodejs";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // límite Whisper API

// Esquema del resumen estructurado que pedimos a Claude. Lo guardamos
// como JSON en el body del comentario del task para que el render
// rich lo pinte con secciones (h3) bien formateadas — igual que el
// MeetingRecorder ya hace en el modal de tarea.
const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Título corto en castellano que resume la reunión (3-8 palabras)" },
    summary: { type: "string", description: "Resumen ejecutivo en 2-4 frases en castellano" },
    participants: { type: "array", items: { type: "string" } },
    topics: { type: "array", items: { type: "string" } },
    decisions: { type: "array", items: { type: "string" } },
    action_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          who: { type: "string" },
          what: { type: "string" },
          when: { type: "string" }
        },
        required: ["who", "what"]
      }
    },
    critical_points: { type: "array", items: { type: "string" } }
  },
  required: ["title", "summary", "topics", "action_items"]
};

type MeetingSummary = {
  title: string;
  summary: string;
  participants?: string[];
  topics: string[];
  decisions?: string[];
  action_items: { who: string; what: string; when?: string }[];
  critical_points?: string[];
};

function detectPlatform(url: string): string {
  if (/meet\.google\.com/.test(url)) return "Google Meet";
  if (/teams\.(microsoft|live)\.com/.test(url)) return "Microsoft Teams";
  if (/zoom\.us/.test(url)) return "Zoom";
  if (/whereby/.test(url)) return "Whereby";
  if (/meet\.jit\.si/.test(url)) return "Jitsi";
  if (/webex/.test(url)) return "Webex";
  return "Reunión web";
}

function buildCommentDoc(s: MeetingSummary, meetingUrl: string, platform: string): any {
  const content: any[] = [];
  content.push({
    type: "heading",
    attrs: { level: 2 },
    content: [{ type: "text", text: `📝 Resumen de la reunión` }]
  });
  content.push({
    type: "paragraph",
    content: [{ type: "text", text: s.summary }]
  });

  if (s.participants && s.participants.length > 0) {
    content.push({ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "👥 Participantes" }] });
    content.push({
      type: "bulletList",
      content: s.participants.map((p) => ({
        type: "listItem",
        content: [{ type: "paragraph", content: [{ type: "text", text: p }] }]
      }))
    });
  }

  if (s.topics && s.topics.length > 0) {
    content.push({ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "💬 Temas tratados" }] });
    content.push({
      type: "bulletList",
      content: s.topics.map((t) => ({
        type: "listItem",
        content: [{ type: "paragraph", content: [{ type: "text", text: t }] }]
      }))
    });
  }

  if (s.decisions && s.decisions.length > 0) {
    content.push({ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "✅ Decisiones" }] });
    content.push({
      type: "bulletList",
      content: s.decisions.map((d) => ({
        type: "listItem",
        content: [{ type: "paragraph", content: [{ type: "text", text: d }] }]
      }))
    });
  }

  if (s.action_items && s.action_items.length > 0) {
    content.push({ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "⚡ Acciones pendientes" }] });
    content.push({
      type: "bulletList",
      content: s.action_items.map((a) => ({
        type: "listItem",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: `${a.who}: `, marks: [{ type: "bold" }] },
              { type: "text", text: a.what + (a.when ? ` (${a.when})` : "") }
            ]
          }
        ]
      }))
    });
  }

  if (s.critical_points && s.critical_points.length > 0) {
    content.push({ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "🚨 Puntos críticos" }] });
    content.push({
      type: "bulletList",
      content: s.critical_points.map((c) => ({
        type: "listItem",
        content: [{ type: "paragraph", content: [{ type: "text", text: c }] }]
      }))
    });
  }

  content.push({
    type: "paragraph",
    content: [
      { type: "text", text: "Grabada en " },
      {
        type: "text",
        text: platform,
        marks: [{ type: "link", attrs: { href: meetingUrl, target: "_blank" } }]
      },
      { type: "text", text: " · capturada vía extensión Hub Reuniones." }
    ]
  });

  return { type: "doc", content };
}

export const POST = withApi({ scope: "tasks:write" }, async (req, { api }) => {
  // Acepta auth por API key (legacy: v0.1 de la extensión) O por
  // sesión NextAuth (v0.2+: la extensión usa cookie del Hub). Las
  // dos resuelven a un userId — el assignee de la tarea.
  if (!api.userId && !api.apiKeyId) {
    throw new ApiError(401, "auth_required", "Sesión requerida");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError(400, "bad_multipart", "Se esperaba multipart/form-data con un audio");
  }

  const audio = form.get("audio");
  const meetingUrl = String(form.get("meetingUrl") ?? "");
  const meetingTitle = String(form.get("meetingTitle") ?? "Reunión");

  if (!(audio instanceof Blob)) {
    throw new ApiError(400, "no_audio", "Falta el campo 'audio'");
  }
  if (audio.size === 0) {
    throw new ApiError(400, "empty_audio", "El audio está vacío");
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    throw new ApiError(
      413,
      "audio_too_large",
      `Audio demasiado largo (${Math.round(audio.size / 1024 / 1024)}MB). Whisper API limita a 25MB. Divide la reunión o sube por chunks.`
    );
  }

  const platform = detectPlatform(meetingUrl);

  // ── 1) Whisper transcribe ──────────────────────────────────────
  let transcript: string;
  try {
    transcript = await transcribeAudioWithWhisper({
      workspaceId: api.workspaceId,
      audio,
      filename: "meeting.webm",
      language: "es"
    });
  } catch (e: any) {
    throw new ApiError(502, "whisper_failed", `Whisper falló: ${e?.message ?? e}`);
  }

  if (!transcript.trim()) {
    throw new ApiError(
      422,
      "empty_transcript",
      "Whisper no transcribió nada (¿reunión en silencio o pestaña sin sonido?)"
    );
  }

  // ── 2) Claude resume ───────────────────────────────────────────
  let summary: MeetingSummary;
  try {
    summary = await completeJson<MeetingSummary>({
      workspaceId: api.workspaceId,
      system:
        "Eres un asistente de actas de reunión. Lees la transcripción y devuelves un " +
        "resumen estructurado en castellano con título corto (3-8 palabras), resumen " +
        "ejecutivo, participantes (si se identifican por nombre), temas tratados, " +
        "decisiones, acciones pendientes con responsable y plazo cuando se mencione, " +
        "y puntos críticos que el equipo debe revisar. Sé fiel a lo dicho — NO " +
        "inventes nombres ni fechas. Si la transcripción es de mala calidad, " +
        "menciónalo en summary y omite las secciones para las que no haya info.",
      user: `Plataforma: ${platform}\nTítulo de la pestaña: ${meetingTitle}\n\nTranscripción:\n\n${transcript}`,
      schema: SUMMARY_SCHEMA,
      maxTokens: 3000,
      feature: "extension_meeting_summary"
    } as any);
  } catch (e: any) {
    throw new ApiError(502, "claude_failed", `Claude falló al resumir: ${e?.message ?? e}`);
  }

  // ── 3) Resolver projectId por defecto ──────────────────────────
  // La extensión no sabe a qué proyecto va la tarea — la API key
  // viene atada a un workspace. Usamos el primer proyecto vivo del
  // workspace como destino. El user puede mover la tarea después.
  const firstProject = await prisma.project.findFirst({
    where: { workspaceId: api.workspaceId, deletedAt: null, archived: false },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });
  if (!firstProject) {
    throw new ApiError(
      404,
      "no_project",
      "El workspace no tiene proyectos activos. Crea uno antes de usar la extensión."
    );
  }

  // ── 4) Crear tarea + comentario con el resumen ────────────────
  // assigneeId: api.userId si viene de sesión NextAuth (cookie de
  // extensión v0.2+); o el dueño de la API key si es legacy v0.1.
  let assigneeId: string | null = api.userId ?? null;
  if (!assigneeId && api.apiKeyId) {
    const apiKey = await prisma.apiKey.findUnique({
      where: { id: api.apiKeyId },
      select: { userId: true }
    });
    assigneeId = apiKey?.userId ?? null;
  }

  const taskTitle = summary.title?.trim() || `Reunión ${new Date().toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}`;
  const commentDoc = buildCommentDoc(summary, meetingUrl, platform);

  const task = await prisma.task.create({
    data: {
      workspaceId: api.workspaceId,
      projectId: firstProject.id,
      title: taskTitle,
      description: `Reunión en ${platform} — ${meetingUrl || "(sin URL)"}\n\n${summary.summary}`,
      status: "TODO",
      priority: "MEDIUM",
      ...(assigneeId
        ? { assignees: { create: [{ userId: assigneeId }] } }
        : {})
    } as any
  });

  // El resumen rich va como comentario para que se vea con las
  // secciones formateadas (heading, bullets) en el modal de tarea.
  if (assigneeId) {
    await prisma.comment.create({
      data: {
        workspaceId: api.workspaceId,
        authorId: assigneeId,
        targetType: "TASK",
        targetId: task.id,
        body: summary.summary,
        bodyJson: commentDoc as any
      }
    });
  }

  auditFromReq(req, api, {
    action: "extension.meeting_uploaded",
    targetType: "TASK",
    targetId: task.id,
    meta: { meetingUrl, platform, durationMs: form.get("durationMs"), audioBytes: audio.size }
  });

  const taskUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://hub.negociovivo.app"}/tareas?task=${task.id}`;
  return NextResponse.json({
    ok: true,
    taskId: task.id,
    taskTitle,
    taskUrl,
    summaryPreview: summary.summary.slice(0, 200)
  });
});
