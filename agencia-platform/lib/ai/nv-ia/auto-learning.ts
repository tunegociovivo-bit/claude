/**
 * Auto-aprendizaje pasivo: Sonia analiza las dinámicas user↔Sonia en
 * tasks recientes y extrae lecciones cuando detecta que el user
 * corrigió, refinó o se quejó de una respuesta suya.
 *
 * Heurística:
 *   1. Tasks DONE o RESOLVED en últimos N días con runs de Sonia.
 *   2. Hilo de comentarios: para cada par consecutivo (sonia → user),
 *      si el comment del user parece corrección (keywords: "no", "en
 *      realidad", "mejor", "deberías", "más bien", "ponle", "cambia",
 *      "evita") → candidato.
 *   3. Pasamos el par a Haiku (cheap) con un system prompt que extrae
 *      una lección estructurada {scope, lesson, triggerPattern} o
 *      decide que no es realmente correctiva.
 *   4. Persistimos con source="auto_extracted" para distinguirla de
 *      las manuales.
 *
 * Dedup: si ya existe una lección con mismo (scope, lesson hash), no
 * se duplica.
 */

import { prisma } from "@/lib/db/prisma";
import { recordLesson } from "@/lib/ai/nv-ia/lessons";
import { getAnthropicForWorkspace } from "@/lib/ai/anthropic";
import crypto from "crypto";

const CORRECTION_HINTS = [
  "no es",
  "no era",
  "no, ",
  "en realidad",
  "mejor",
  "deberías",
  "deberias",
  "deberiamos",
  "más bien",
  "mas bien",
  "ponle",
  "cambia",
  "evita",
  "no uses",
  "no digas",
  "no menciones",
  "fíjate",
  "fijate",
  "ojo",
  "mal redactado",
  "demasiado",
  "muy formal",
  "muy informal",
  "no es así",
  "no hace falta",
  "vuelve a"
];

function looksLikeCorrection(text: string): boolean {
  const t = text.toLowerCase();
  return CORRECTION_HINTS.some((h) => t.includes(h));
}

export async function extractLessonsForWorkspace(opts: {
  workspaceId: string;
  daysBack?: number;
  /** Cap de candidatos a procesar en una pasada (cada uno cuesta ~1¢ Haiku). */
  maxCandidates?: number;
}): Promise<{
  scanned: number;
  candidates: number;
  lessonsCreated: number;
  skipped: Array<{ reason: string; commentId?: string }>;
}> {
  const daysBack = opts.daysBack ?? 7;
  const maxCandidates = opts.maxCandidates ?? 30;
  const since = new Date(Date.now() - daysBack * 86400_000);

  // 1) Usuario IA de este workspace
  const ws = await prisma.workspace.findUnique({
    where: { id: opts.workspaceId },
    select: { settings: true }
  });
  const aiUserId = (ws?.settings as any)?.aiAgent?.userId as string | undefined;
  if (!aiUserId) {
    return { scanned: 0, candidates: 0, lessonsCreated: 0, skipped: [{ reason: "sin aiAgent.userId" }] };
  }

  // 2) Comentarios de Sonia en últimos N días
  const soniaComments = await prisma.comment.findMany({
    where: {
      workspaceId: opts.workspaceId,
      targetType: "TASK",
      authorId: aiUserId,
      createdAt: { gte: since }
    },
    orderBy: { createdAt: "asc" },
    take: 500
  });

  // 3) Para cada uno, busca el siguiente comentario del MISMO task hecho
  //    por OTRO autor en las próximas 6 horas.
  const candidates: Array<{
    soniaComment: typeof soniaComments[number];
    userReply: any;
    taskId: string;
    clientId: string | null;
  }> = [];

  for (const sc of soniaComments) {
    const after = sc.createdAt.getTime();
    const limit = new Date(after + 6 * 3600_000);
    const reply = await prisma.comment.findFirst({
      where: {
        workspaceId: opts.workspaceId,
        targetType: "TASK",
        targetId: sc.targetId,
        authorId: { not: aiUserId },
        createdAt: { gt: sc.createdAt, lte: limit }
      },
      orderBy: { createdAt: "asc" }
    });
    if (!reply) continue;
    if (!looksLikeCorrection(reply.body)) continue;
    if (reply.body.length < 8) continue;

    // ClientId de la task
    const task = await prisma.task.findFirst({
      where: { id: sc.targetId, workspaceId: opts.workspaceId },
      select: { clientId: true }
    });
    candidates.push({
      soniaComment: sc,
      userReply: reply,
      taskId: sc.targetId,
      clientId: task?.clientId ?? null
    });
    if (candidates.length >= maxCandidates) break;
  }

  if (candidates.length === 0) {
    return {
      scanned: soniaComments.length,
      candidates: 0,
      lessonsCreated: 0,
      skipped: []
    };
  }

  // 4) Llama a Haiku para clasificar/extraer
  const client = await getAnthropicForWorkspace(opts.workspaceId);
  const skipped: Array<{ reason: string; commentId?: string }> = [];
  let lessonsCreated = 0;

  for (const c of candidates) {
    try {
      const resp = await client.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 400,
        system: [
          {
            type: "text",
            text:
              "Eres analista de feedback. Recibes (1) un mensaje de Sonia (IA) y (2) la respuesta del humano. Determina si el humano está CORRIGIENDO/AJUSTANDO algo concreto que Sonia debería aprender, o si solo es conversación normal. Responde SIEMPRE en JSON estricto."
          }
        ],
        messages: [
          {
            role: "user",
            content: `MENSAJE DE SONIA:\n${c.soniaComment.body.slice(0, 1500)}\n\n---\n\nRESPUESTA DEL HUMANO:\n${c.userReply.body.slice(0, 1500)}\n\n---\n\nDevuelve JSON con esta estructura EXACTA:\n{\n  "isCorrection": boolean,\n  "lesson": "Instrucción breve y accionable de qué hacer/evitar la próxima vez. Máx 200 chars. Vacío si isCorrection=false.",\n  "triggerPattern": "Palabra/frase clave para detectar contextos similares. Vacío si no aplica.",\n  "scope": "general" | "client" | "task_type"\n}\n\nSi el humano dice cosas tipo \"OK\", \"gracias\", \"vale\", \"perfecto\" → isCorrection=false.\nSi corrige tono, contenido, formato, datos → isCorrection=true.`
          }
        ]
      });
      const text = (resp.content.find((b: any) => b.type === "text") as any)?.text ?? "";
      const m = /\{[\s\S]*\}/.exec(text);
      if (!m) {
        skipped.push({ reason: "parse_fail", commentId: c.userReply.id });
        continue;
      }
      const parsed = JSON.parse(m[0]) as {
        isCorrection?: boolean;
        lesson?: string;
        triggerPattern?: string;
        scope?: string;
      };
      if (!parsed.isCorrection || !parsed.lesson || parsed.lesson.length < 10) {
        skipped.push({ reason: "not_correction", commentId: c.userReply.id });
        continue;
      }

      const scope =
        parsed.scope === "client" && c.clientId
          ? `client:${c.clientId}`
          : parsed.scope === "task_type"
            ? `task_type:auto`
            : "general";

      // Dedup: hash del scope+lesson
      const hash = crypto
        .createHash("md5")
        .update(`${scope}|${parsed.lesson.trim().toLowerCase()}`)
        .digest("hex")
        .slice(0, 12);
      const existing = await prisma.aiAgentLesson.findFirst({
        where: {
          workspaceId: opts.workspaceId,
          scope,
          isActive: true,
          lesson: { contains: parsed.lesson.slice(0, 60) }
        }
      });
      if (existing) {
        skipped.push({ reason: "dedup", commentId: c.userReply.id });
        continue;
      }

      await recordLesson({
        workspaceId: opts.workspaceId,
        scope,
        lesson: parsed.lesson.slice(0, 1000),
        triggerPattern: parsed.triggerPattern?.slice(0, 200) || undefined,
        source: "auto_extracted",
        taskId: c.taskId
      });
      lessonsCreated++;
      console.log(
        `[sonia learning] lesson extraída scope=${scope} hash=${hash} → ${parsed.lesson.slice(0, 80)}`
      );
    } catch (e: any) {
      skipped.push({ reason: `error: ${e?.message?.slice(0, 80)}`, commentId: c.userReply.id });
    }
  }

  return {
    scanned: soniaComments.length,
    candidates: candidates.length,
    lessonsCreated,
    skipped
  };
}
