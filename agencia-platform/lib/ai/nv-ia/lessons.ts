/**
 * Memoria persistente del agente: Lecciones aprendidas.
 *
 * Cada vez que Sonia (o Claude tras resolver una escalación) aprende
 * algo nuevo sobre cómo hacer una tarea, se persiste como
 * AiAgentLesson. En el siguiente run que sea similar, el runner
 * carga las lecciones aplicables y las inyecta al system prompt.
 * Sonia "aprende" entre runs sin necesidad de re-entrenar el modelo.
 *
 * Filosofía: las lecciones son INSTRUCCIONES CORTAS Y ACCIONABLES,
 * no resúmenes largos. "Cuando X, haz Y" — no "en mayo de 2026
 * pasó tal cosa con tal cliente y...".
 */

import { prisma } from "@/lib/db/prisma";

export type Lesson = {
  id: string;
  scope: string;
  lesson: string;
  triggerPattern: string | null;
  source: string;
  taskId: string | null;
  useCount: number;
};

/**
 * Carga las lecciones relevantes para un run concreto. Se aplican
 * filtros en cascada:
 *   1. workspaceId (siempre)
 *   2. isActive
 *   3. scope que matchea con el contexto (task, tools, client)
 *   4. triggerPattern (regex/keyword) si existe
 *
 * Devuelve hasta `limit` lecciones, priorizando useCount desc.
 */
export async function loadLessonsForRun(opts: {
  workspaceId: string;
  /** Texto agregado del contexto: título + descripción + primer trigger. */
  contextText: string;
  /** Lista de scopes a considerar. Ej:
   *  ["general", "client:abc123", "task_type:meta_lead_campaign"]. */
  scopes: string[];
  limit?: number;
}): Promise<Lesson[]> {
  const limit = opts.limit ?? 12;
  // Primero: lecciones con scope "general" (siempre) + los scopes
  // específicos pasados.
  const allScopes = Array.from(new Set(["general", ...opts.scopes]));
  const rows = await prisma.aiAgentLesson.findMany({
    where: {
      workspaceId: opts.workspaceId,
      isActive: true,
      scope: { in: allScopes }
    },
    orderBy: [{ useCount: "desc" }, { updatedAt: "desc" }],
    take: limit * 3 // sobre-fetch para filtrar por trigger después
  });

  const filtered: Lesson[] = [];
  const ctxLower = opts.contextText.toLowerCase();
  for (const r of rows) {
    if (r.triggerPattern) {
      try {
        const re = new RegExp(r.triggerPattern, "i");
        if (!re.test(opts.contextText)) {
          // Si triggerPattern es un patrón válido pero no matchea,
          // omitir. Si no es regex válida, fallback a substring.
          continue;
        }
      } catch {
        if (!ctxLower.includes(r.triggerPattern.toLowerCase())) continue;
      }
    }
    filtered.push({
      id: r.id,
      scope: r.scope,
      lesson: r.lesson,
      triggerPattern: r.triggerPattern,
      source: r.source,
      taskId: r.taskId,
      useCount: r.useCount
    });
    if (filtered.length >= limit) break;
  }

  // Marca las lecciones como usadas (fire-and-forget).
  if (filtered.length > 0) {
    const ids = filtered.map((l) => l.id);
    prisma.aiAgentLesson
      .updateMany({
        where: { id: { in: ids } },
        data: { useCount: { increment: 1 }, lastUsedAt: new Date() }
      })
      .catch(() => {});
  }

  return filtered;
}

/**
 * Persiste una nueva lección. Idempotente por (workspaceId, scope,
 * lesson) — si ya existe una idéntica, no duplica, solo incrementa
 * useCount.
 */
export async function recordLesson(opts: {
  workspaceId: string;
  scope: string;
  lesson: string;
  triggerPattern?: string | null;
  source: "claude" | "sonia_self" | "human";
  taskId?: string | null;
}): Promise<{ id: string; created: boolean }> {
  const lessonText = opts.lesson.trim();
  if (lessonText.length < 8) {
    throw new Error("Lesson demasiado corta (mínimo 8 chars)");
  }
  if (lessonText.length > 2000) {
    throw new Error("Lesson demasiado larga (máximo 2000 chars). Resume.");
  }
  // Dedupe: mismo workspace + scope + texto idéntico → no duplicar.
  const existing = await prisma.aiAgentLesson.findFirst({
    where: {
      workspaceId: opts.workspaceId,
      scope: opts.scope,
      lesson: lessonText,
      isActive: true
    }
  });
  if (existing) {
    await prisma.aiAgentLesson.update({
      where: { id: existing.id },
      data: { useCount: { increment: 1 }, lastUsedAt: new Date() }
    });
    return { id: existing.id, created: false };
  }
  const created = await prisma.aiAgentLesson.create({
    data: {
      workspaceId: opts.workspaceId,
      scope: opts.scope,
      lesson: lessonText,
      triggerPattern: opts.triggerPattern ?? null,
      source: opts.source,
      taskId: opts.taskId ?? null
    }
  });
  return { id: created.id, created: true };
}

/**
 * Construye un bloque de texto con las lecciones formateado para
 * inyectarlo al final del initial message del runner. Si no hay
 * lecciones, devuelve string vacío.
 */
export function formatLessonsForPrompt(lessons: Lesson[]): string {
  if (lessons.length === 0) return "";
  const lines = lessons.map((l, i) => `${i + 1}. [${l.scope}] ${l.lesson}`);
  return (
    `\n\n📚 LECCIONES APRENDIDAS DE TAREAS ANTERIORES (aplicables a esta):\n` +
    lines.join("\n") +
    `\n\nSi alguna lección no aplica a esta task concreta, ignórala. ` +
    `Si descubres una nueva mejor práctica durante este run que querrás recordar para próximas tareas, llama a record_lesson.`
  );
}

/**
 * Infiere automáticamente los scopes aplicables a una task a
 * partir de su título + descripción + clientId opcional. Heurística
 * por palabras clave — suficiente para empezar; en el futuro se
 * podría reemplazar por un clasificador IA.
 */
export function inferScopesForTask(opts: {
  taskTitle: string;
  taskDescription: string;
  clientId?: string | null;
}): string[] {
  const text = `${opts.taskTitle} ${opts.taskDescription}`.toLowerCase();
  const scopes: string[] = [];

  // Por tipo de tarea (más comunes en una agencia)
  if (/lead\s*ads|formulario.*lead|campaña.*meta|campaña.*facebook|crear.*anuncio/.test(text)) {
    scopes.push("task_type:meta_lead_campaign");
  }
  if (/descargar.*leads|exportar.*leads|csv.*leads|excel.*leads/.test(text)) {
    scopes.push("task_type:download_leads");
  }
  if (/informe|report|reporte/.test(text)) {
    scopes.push("task_type:report");
  }
  if (/google\s*ads|search\s*ads|adwords/.test(text)) {
    scopes.push("task_type:google_ads");
  }
  if (/holded|factura|invoice|presupuesto/.test(text)) {
    scopes.push("task_type:billing");
  }
  if (/whatsapp|email\s*marketing|mailing/.test(text)) {
    scopes.push("task_type:outbound_comms");
  }
  if (/seo|posicionamiento|keyword/.test(text)) {
    scopes.push("task_type:seo");
  }

  // Por tools mencionadas explícitamente
  const toolMentions = [
    "meta_ads",
    "google_ads",
    "holded",
    "stripe",
    "drive",
    "waha",
    "ahrefs",
    "metricool"
  ];
  for (const t of toolMentions) {
    if (text.includes(t)) scopes.push(`tool:${t}`);
  }

  // Por cliente
  if (opts.clientId) scopes.push(`client:${opts.clientId}`);

  return scopes;
}
