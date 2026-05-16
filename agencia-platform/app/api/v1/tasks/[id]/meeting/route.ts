/**
 * POST /api/v1/tasks/[id]/meeting
 *
 * Recibe un audio multipart (campo "audio") grabado por el navegador
 * en MeetingRecorder, lo transcribe con Whisper y le pide a Claude un
 * resumen estructurado. El resultado se inserta como un Comment
 * formateado en TipTap dentro de la tarea, de forma que el equipo
 * vea el resumen junto al resto del contexto.
 *
 * No persiste el audio en el bucket — el resumen es lo valioso a
 * largo plazo. Si más adelante quieres que se guarde como adjunto,
 * sube el blob al endpoint /api/v1/files antes de mandarlo aquí y
 * referencia el fileId en el comentario.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { transcribeAudioWithWhisper } from "@/lib/ai/openai";
import { complete, AIDisabledError } from "@/lib/ai/anthropic";

export const dynamic = "force-dynamic";
// Reuniones pueden tardar — Whisper sobre un audio de 15 min suele
// tomar 30-60s, más el resumen Claude. Subimos el timeout máximo.
export const maxDuration = 300;

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // límite duro de Whisper

const SUMMARY_SYSTEM = `Eres un asistente que resume reuniones de trabajo de una agencia.
Lee la transcripción y produce ÚNICAMENTE un JSON válido (sin texto antes ni después)
con esta forma exacta:

{
  "summary": "1-3 frases con la idea general de la reunión.",
  "key_points": ["punto importante 1", "punto importante 2"],
  "decisions": ["decisión tomada 1"],
  "action_items": [
    { "title": "Tarea concreta", "assignee": "Nombre o null", "due": "YYYY-MM-DD o null" }
  ],
  "open_questions": ["pregunta sin resolver 1"]
}

Reglas:
- Escribe en el mismo idioma de la transcripción (probablemente español).
- Si una sección no aplica, devuelve una lista vacía, no la omitas.
- En action_items, "assignee" debe ser el nombre mencionado o null si no se asignó.
- En "due", interpreta fechas relativas ("el lunes", "esta semana") a la fecha
  ISO concreta usando la referencia temporal que te dé el usuario; si no puedes,
  pon null.
- No inventes información que no esté en la transcripción.`;

type Summary = {
  summary: string;
  key_points: string[];
  decisions: string[];
  action_items: { title: string; assignee?: string | null; due?: string | null }[];
  open_questions: string[];
};

export const POST = withApi({ scope: "tasks:write" }, async (req: NextRequest, { params, api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Reuniones requieren sesión humana");

  // Validar tarea
  const task = await prisma.task.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: { id: true, title: true }
  });
  if (!task) throw new ApiError(404, "not_found", "Tarea no encontrada");

  const form = await req.formData();
  const audio = form.get("audio");
  const durationSec = Number(form.get("durationSec") ?? 0);
  if (!(audio instanceof Blob)) {
    throw new ApiError(400, "no_audio", "Falta el campo 'audio'");
  }
  if (audio.size === 0) throw new ApiError(400, "empty_audio", "Audio vacío");
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      {
        error: {
          code: "audio_too_large",
          message: `El audio supera el límite de Whisper (25 MB). Te has grabado ${(
            audio.size /
            (1024 * 1024)
          ).toFixed(1)} MB. Reduce la duración o divide la reunión.`
        }
      },
      { status: 413 }
    );
  }

  // 1. Transcribir
  let transcript: string;
  try {
    transcript = await transcribeAudioWithWhisper({
      workspaceId: api.workspaceId,
      audio,
      filename: "meeting.webm",
      language: "es"
    });
  } catch (e: any) {
    if (e instanceof AIDisabledError) {
      return NextResponse.json(
        { error: { code: "ai_not_configured", message: e.message } },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: { code: "transcribe_failed", message: e?.message ?? "Whisper falló" } },
      { status: 500 }
    );
  }
  if (!transcript || transcript.length < 10) {
    return NextResponse.json(
      {
        error: {
          code: "empty_transcript",
          message: "Whisper no detectó voz. ¿Estaba el micrófono mudo o muy lejos?"
        }
      },
      { status: 422 }
    );
  }

  // 2. Resumen con Claude
  let summary: Summary;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const raw = await complete({
      workspaceId: api.workspaceId,
      system: SUMMARY_SYSTEM,
      user: `Hoy es ${today}. Transcripción:\n\n${transcript}`,
      userId: api.userId,
      feature: "meeting_summary",
      maxTokens: 2000
    });
    summary = parseSummary(raw);
  } catch (e: any) {
    if (e instanceof AIDisabledError) {
      return NextResponse.json(
        { error: { code: "ai_not_configured", message: e.message } },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: { code: "summary_failed", message: e?.message ?? "Resumen falló" } },
      { status: 500 }
    );
  }

  // 3. Insertar como comentario rich (TipTap doc) en la tarea
  const doc = buildCommentDoc({ summary, transcript, durationSec });
  const comment = await prisma.comment.create({
    data: {
      workspaceId: api.workspaceId,
      authorId: api.userId,
      targetType: "TASK",
      targetId: params.id,
      body: JSON.stringify(doc),
      bodyJson: doc as any
    },
    include: { author: { select: { id: true, name: true, image: true } } }
  });

  return NextResponse.json({
    comment,
    actionItems: summary.action_items,
    transcript // por si la UI quiere mostrarlo expandible aparte
  });
});

function parseSummary(raw: string): Summary {
  // Claude debería devolver solo JSON, pero a veces envuelve. Quitamos
  // fences markdown y buscamos el primer "{" hasta el último "}".
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Respuesta IA no es JSON");
  }
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  return {
    summary: String(parsed.summary ?? ""),
    key_points: Array.isArray(parsed.key_points) ? parsed.key_points.map(String) : [],
    decisions: Array.isArray(parsed.decisions) ? parsed.decisions.map(String) : [],
    action_items: Array.isArray(parsed.action_items)
      ? parsed.action_items.map((a: any) => ({
          title: String(a.title ?? ""),
          assignee: a.assignee ? String(a.assignee) : null,
          due: a.due ? String(a.due) : null
        }))
      : [],
    open_questions: Array.isArray(parsed.open_questions)
      ? parsed.open_questions.map(String)
      : []
  };
}

function buildCommentDoc(args: { summary: Summary; transcript: string; durationSec: number }): any {
  const { summary, transcript, durationSec } = args;
  const mm = Math.floor(durationSec / 60);
  const ss = durationSec % 60;
  const duration = `${mm}:${String(ss).padStart(2, "0")}`;

  const content: any[] = [
    {
      type: "heading",
      attrs: { level: 3 },
      content: [{ type: "text", text: `🎙️ Resumen de reunión (${duration})` }]
    },
    paragraph(summary.summary)
  ];

  if (summary.key_points.length) {
    content.push(heading("Puntos clave"));
    content.push(bulletList(summary.key_points));
  }
  if (summary.decisions.length) {
    content.push(heading("Decisiones"));
    content.push(bulletList(summary.decisions));
  }
  if (summary.action_items.length) {
    content.push(heading("Tareas pendientes"));
    content.push(
      bulletList(
        summary.action_items.map((a) => {
          const parts = [a.title];
          if (a.assignee) parts.push(`→ ${a.assignee}`);
          if (a.due) parts.push(`(${a.due})`);
          return parts.join(" ");
        })
      )
    );
  }
  if (summary.open_questions.length) {
    content.push(heading("Preguntas abiertas"));
    content.push(bulletList(summary.open_questions));
  }

  // Transcripción completa en un blockquote colapsable visual (TipTap
  // no tiene "details" nativo; lo dejamos como blockquote pequeño
  // para que no domine pero esté disponible).
  content.push(heading("Transcripción"));
  content.push({
    type: "blockquote",
    content: transcript
      .split(/\n+/)
      .filter(Boolean)
      .map((line) => paragraph(line))
  });

  return { type: "doc", content };
}

function paragraph(text: string): any {
  return { type: "paragraph", content: text ? [{ type: "text", text }] : [] };
}
function heading(text: string): any {
  return { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text }] };
}
function bulletList(items: string[]): any {
  return {
    type: "bulletList",
    content: items.map((t) => ({
      type: "listItem",
      content: [paragraph(t)]
    }))
  };
}
