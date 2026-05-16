/**
 * POST /api/v1/tasks/voice-create
 *
 * Recibe un audio multipart (campo `audio`), lo transcribe con
 * Whisper y le pide a Claude que extraiga los campos de una tarea
 * estructurada. Devuelve el draft SIN crear la tarea — el cliente
 * lo muestra al usuario para que confirme/edite antes de POSTear
 * a /api/v1/tasks.
 *
 * Body multipart:
 *   audio       → blob webm/ogg/mp3
 *   workspaceId → (opcional, viene del contexto)
 *   projectHint → (opcional) projectId/nombre del proyecto en el
 *                 que el user estaba viendo el kanban — para que
 *                 la IA priorice ese proyecto al asignar.
 *
 * Devuelve:
 *   {
 *     transcript: "lo que dijiste",
 *     draft: {
 *       title, description?, priority?, dueDate?, dueTime?,
 *       projectName?, assigneeNames?, tagNames?
 *     }
 *   }
 *
 * Idéntico patrón al endpoint /tasks/[id]/meeting pero más simple
 * (una sola tarea en lugar de resumen + acciones).
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { transcribeAudioWithWhisper } from "@/lib/ai/openai";
import { AIDisabledError, complete } from "@/lib/ai/anthropic";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const DRAFT_SYSTEM = `Eres un asistente que escucha a alguien dictando una tarea
para apuntarla en una plataforma estilo Asana. Lee la transcripción y devuelve
ÚNICAMENTE un JSON válido con la estructura:

{
  "title": "Título corto y accionable (máx 80 chars, en imperativo).",
  "description": "Detalle adicional si lo hay (puede ser null).",
  "priority": "urgent" | "high" | "normal" | null,
  "dueDate": "YYYY-MM-DD o null",
  "dueTime": "HH:MM o null",
  "projectName": "Nombre del proyecto si lo mencionó o null",
  "assigneeNames": ["Nombre 1", "Nombre 2"] o [],
  "tagNames": ["tag1", "tag2"] o []
}

Reglas:
- Idioma: el de la transcripción (probablemente español).
- title: 4-12 palabras, empieza con verbo cuando puedas
  ("Llamar a…", "Revisar…", "Enviar…").
- description: solo si añade contexto útil que no quepa en el título.
- priority: "urgent" si oyes "urgente/ya/críticamente"; "high" si oyes
  "importante/prioridad alta"; "normal" en cualquier otro caso o si
  no se menciona.
- dueDate: interpreta fechas relativas usando la fecha de hoy que te
  da el usuario. "Mañana" → mañana. "El lunes" → próximo lunes.
- dueTime: si menciona hora concreta ("a las 9", "a las 14:30").
- projectName / assigneeNames: SOLO si se mencionan literalmente
  por nombre. NUNCA los inventes.
- tagNames: etiquetas mencionadas (#cliente-X, "marcado como
  marketing"...) o vacío.`;

type Draft = {
  title: string;
  description: string | null;
  priority: "urgent" | "high" | "normal" | null;
  dueDate: string | null;
  dueTime: string | null;
  projectName: string | null;
  assigneeNames: string[];
  tagNames: string[];
};

export const POST = withApi({ scope: "tasks:write" }, async (req: NextRequest, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión humana requerida");

  const form = await req.formData();
  const audio = form.get("audio");
  if (!(audio instanceof Blob)) throw new ApiError(400, "no_audio", "Falta el campo 'audio'");
  if (audio.size === 0) throw new ApiError(400, "empty_audio", "Audio vacío");
  if (audio.size > MAX_AUDIO_BYTES) {
    throw new ApiError(413, "too_large", `Audio supera 25 MB`);
  }

  // 1. Whisper
  let transcript: string;
  try {
    transcript = await transcribeAudioWithWhisper({
      workspaceId: api.workspaceId,
      audio,
      filename: "task-voice.webm",
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
  if (!transcript || transcript.trim().length < 3) {
    return NextResponse.json(
      { error: { code: "empty_transcript", message: "No se detectó voz clara" } },
      { status: 422 }
    );
  }

  // 2. Claude extracts structured draft
  let draft: Draft;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const raw = await complete({
      workspaceId: api.workspaceId,
      system: DRAFT_SYSTEM,
      user: `Hoy es ${today}.\n\nTranscripción:\n${transcript}`,
      userId: api.userId,
      feature: "voice_task",
      maxTokens: 500
    });
    draft = parseDraft(raw);
  } catch (e: any) {
    if (e instanceof AIDisabledError) {
      return NextResponse.json(
        { error: { code: "ai_not_configured", message: e.message } },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: { code: "draft_failed", message: e?.message ?? "Generación de tarea falló" } },
      { status: 500 }
    );
  }

  // 3. Resolución básica: si la IA mencionó projectName, intentamos
  // matchear contra los proyectos del workspace para devolverle al
  // cliente un projectId concreto. Si no, dejamos null y el cliente
  // muestra el nombre detectado como sugerencia.
  let resolvedProjectId: string | null = null;
  if (draft.projectName) {
    const projects = await prisma.project.findMany({
      where: { workspaceId: api.workspaceId, archived: false, deletedAt: null } as any,
      select: { id: true, name: true }
    });
    const norm = (s: string) =>
      s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
    const target = norm(draft.projectName);
    const hit = projects.find((p) => norm(p.name) === target);
    if (hit) resolvedProjectId = hit.id;
  }

  // Lo mismo para assignees: convertimos nombres → userIds del workspace.
  const resolvedAssigneeIds: string[] = [];
  if (draft.assigneeNames.length > 0) {
    const members = await prisma.user.findMany({
      where: { memberships: { some: { workspaceId: api.workspaceId } } },
      select: { id: true, name: true, email: true }
    });
    const norm = (s: string) =>
      s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
    for (const an of draft.assigneeNames) {
      const target = norm(an);
      const hit = members.find(
        (m) => norm(m.name ?? "") === target || norm(m.email).split("@")[0] === target
      );
      if (hit) resolvedAssigneeIds.push(hit.id);
    }
  }

  return NextResponse.json({
    transcript,
    draft,
    resolved: {
      projectId: resolvedProjectId,
      assigneeIds: resolvedAssigneeIds
    }
  });
});

function parseDraft(raw: string): Draft {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Respuesta IA no es JSON");
  const j = JSON.parse(cleaned.slice(start, end + 1));
  return {
    title: String(j.title ?? "").slice(0, 200),
    description: j.description ? String(j.description) : null,
    priority:
      j.priority === "urgent" || j.priority === "high" || j.priority === "normal"
        ? j.priority
        : null,
    dueDate: j.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(j.dueDate) ? j.dueDate : null,
    dueTime: j.dueTime && /^\d{2}:\d{2}$/.test(j.dueTime) ? j.dueTime : null,
    projectName: j.projectName ? String(j.projectName) : null,
    assigneeNames: Array.isArray(j.assigneeNames) ? j.assigneeNames.map(String) : [],
    tagNames: Array.isArray(j.tagNames) ? j.tagNames.map(String) : []
  };
}
