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

const SUMMARY_SYSTEM = `Eres un asistente que toma notas exhaustivas de reuniones
de trabajo de una agencia. Lee la transcripción completa y produce ÚNICAMENTE
un JSON válido (sin texto antes ni después) con esta forma exacta:

{
  "summary": "Párrafo completo (3-8 frases) con TODO lo importante: qué se habló, contexto, conclusiones, sensación general. NO 'frase corta', necesitamos contenido real.",
  "participants": ["Nombre 1", "Nombre 2"],
  "topics": ["Tema 1 que se trató", "Tema 2 que se trató"],
  "critical_points": ["Cosa de vital importancia 1", "Cosa de vital importancia 2"],
  "key_points": ["Punto destacable 1", "Punto destacable 2"],
  "decisions": ["Decisión que se tomó"],
  "open_questions": ["Pregunta sin resolver"],
  "action_items": [
    {
      "title": "Acción concreta y específica",
      "assignee": "Nombre del responsable o null",
      "due": "YYYY-MM-DD o null",
      "tool": "subtask" | "email" | "calendar_event" | "document",
      "tool_details": "Descripción breve de qué se ejecutaría: para email incluye destinatario y asunto sugerido; para calendar_event incluye fecha/hora propuesta; para document, el título sugerido del doc; para subtask, vacío.",
      "executable": true | false
    }
  ]
}

Reglas:
- Escribe en el mismo idioma de la transcripción (probablemente español).
- Si una sección no aplica, devuelve una lista vacía, no la omitas.
- "participants": deduce de quién habla o de quién se menciona — pon nombres reales si los oyes, no descripciones genéricas.
- "topics": son los GRANDES temas tratados, 3-7. Distinto de key_points (que son frases concretas).
- "critical_points": cosas que NO se pueden olvidar, deadlines duros, urgencias, presupuestos cerrados, compromisos importantes.
- "tool" indica qué tipo de acción es:
    - "email"          → si hay que enviar un correo concreto a alguien.
    - "calendar_event" → si hay que programar una reunión, recordatorio o evento en el calendario.
    - "document"       → si hay que crear un documento, propuesta, brief, etc.
    - "subtask"        → cualquier otra cosa, tarea genérica de seguimiento.
- "executable": true si la acción se puede ejecutar de forma automatizada (ej. crear una subtarea, crear un evento, redactar un borrador de email, crear un doc). false si requiere intervención humana imprescindible (negociar precio, llamar por teléfono, ir físicamente).
- "tool_details": detalles que necesitamos para ejecutar. Para emails sugiere destinatario + asunto + 1 línea de contenido. Para calendar, fecha y hora propuestas si se mencionaron. Para document, título sugerido.
- En "due", interpreta fechas relativas ("el lunes", "esta semana") usando la fecha de referencia del usuario; si no puedes, pon null.
- No inventes información que no esté en la transcripción.`;

type ActionTool = "subtask" | "email" | "calendar_event" | "document";

type Summary = {
  summary: string;
  participants: string[];
  topics: string[];
  critical_points: string[];
  key_points: string[];
  decisions: string[];
  open_questions: string[];
  action_items: {
    title: string;
    assignee?: string | null;
    due?: string | null;
    tool: ActionTool;
    tool_details?: string | null;
    executable: boolean;
  }[];
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
    // Devolvemos el summary entero para que la UI pueda pintar el
    // panel post-grabación con todas las secciones, no solo las
    // acciones.
    summary,
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
  const validTools: ActionTool[] = ["subtask", "email", "calendar_event", "document"];
  return {
    summary: String(parsed.summary ?? ""),
    participants: Array.isArray(parsed.participants) ? parsed.participants.map(String) : [],
    topics: Array.isArray(parsed.topics) ? parsed.topics.map(String) : [],
    critical_points: Array.isArray(parsed.critical_points) ? parsed.critical_points.map(String) : [],
    key_points: Array.isArray(parsed.key_points) ? parsed.key_points.map(String) : [],
    decisions: Array.isArray(parsed.decisions) ? parsed.decisions.map(String) : [],
    open_questions: Array.isArray(parsed.open_questions)
      ? parsed.open_questions.map(String)
      : [],
    action_items: Array.isArray(parsed.action_items)
      ? parsed.action_items.map((a: any) => {
          const tool = validTools.includes(a.tool) ? (a.tool as ActionTool) : "subtask";
          return {
            title: String(a.title ?? ""),
            assignee: a.assignee ? String(a.assignee) : null,
            due: a.due ? String(a.due) : null,
            tool,
            tool_details: a.tool_details ? String(a.tool_details) : null,
            executable: a.executable !== false // por defecto true
          };
        })
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
    }
  ];

  if (summary.summary) {
    content.push(paragraph(summary.summary));
  }

  if (summary.participants.length) {
    content.push(heading("👥 Participantes"));
    content.push(bulletList(summary.participants));
  }

  if (summary.topics.length) {
    content.push(heading("🗂️ Temas tratados"));
    content.push(bulletList(summary.topics));
  }

  if (summary.critical_points.length) {
    content.push(heading("⚠️ Vital importancia"));
    content.push(bulletList(summary.critical_points));
  }

  if (summary.key_points.length) {
    content.push(heading("📌 Puntos clave"));
    content.push(bulletList(summary.key_points));
  }

  if (summary.decisions.length) {
    content.push(heading("✓ Decisiones"));
    content.push(bulletList(summary.decisions));
  }

  if (summary.action_items.length) {
    content.push(heading("📋 Acciones / tareas pendientes"));
    content.push(
      bulletList(
        summary.action_items.map((a) => {
          const parts = [`[${labelForTool(a.tool)}] ${a.title}`];
          if (a.assignee) parts.push(`→ ${a.assignee}`);
          if (a.due) parts.push(`(${a.due})`);
          if (a.tool_details) parts.push(`· ${a.tool_details}`);
          return parts.join(" ");
        })
      )
    );
  }

  if (summary.open_questions.length) {
    content.push(heading("❓ Preguntas abiertas"));
    content.push(bulletList(summary.open_questions));
  }

  // Transcripción completa en un blockquote pequeño.
  content.push(heading("📝 Transcripción"));
  content.push({
    type: "blockquote",
    content: transcript
      .split(/\n+/)
      .filter(Boolean)
      .map((line) => paragraph(line))
  });

  return { type: "doc", content };
}

function labelForTool(tool: ActionTool): string {
  switch (tool) {
    case "email":
      return "✉️ Email";
    case "calendar_event":
      return "📅 Evento";
    case "document":
      return "📄 Documento";
    case "subtask":
    default:
      return "✅ Subtarea";
  }
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
