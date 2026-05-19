/**
 * GET /api/v1/tasks/[id]/sonia-speak
 *
 * Devuelve audio MP3 con Sonia diciendo qué ha pasado con la task.
 * El cliente lo reproduce en lugar del beep cuando notifyMode="voice".
 *
 * Estrategia de texto (mucha más calidad que volcado bruto del summary):
 *   - Si run.summary > ~120 chars, llamamos a Haiku para sintetizarlo
 *     en UNA frase corta + natural, libre de markdown y emojis. Cacheamos
 *     el resultado en Workspace.settings.aiAgent.speakCache[runId] para
 *     no re-llamar a Haiku ni a ElevenLabs en posteriores poll.
 *   - Si es corto, lo limpiamos rápido y pa'lante.
 *   - Si run.summary está vacío, frase fija con el título de la task.
 *
 * Si ElevenLabs no está configurado, devolvemos 204 (No Content) —
 * el cliente cae a beep por su cuenta.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { elevenlabsSynthesize } from "@/lib/integrations/elevenlabs";
import { getAnthropicForWorkspace } from "@/lib/ai/anthropic";

export const dynamic = "force-dynamic";

/**
 * Quita markdown común para que no se lea "asterisco asterisco":
 * **bold**, _ital_, `code`, [text](url), emojis, headings, listas.
 */
function stripMarkdownForSpeech(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[.*?\]\(.*?\)/g, " ")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/(?:^|\n)#+\s*/g, " ")
    .replace(/(?:^|\n)[-*+]\s+/g, " ")
    .replace(/(?:^|\n)\d+\.\s+/g, " ")
    // Emojis y pictogramas básicos (rango Unicode emoji)
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2700}-\u{27BF}]/gu, "")
    // Checkmarks comunes
    .replace(/[✅✔️❌⚠️⛔🚨🔍📎📊📍💡🎙🔔🔕📞📧]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Llama a Haiku para reducir un summary largo a UNA frase coloquial,
 * sin markdown, lista para text-to-speech. Coste ~$0.0005.
 */
async function haikuSummarize(opts: {
  workspaceId: string;
  taskTitle: string;
  rawSummary: string;
  intent: "completed" | "needs_help" | "replied" | "failed";
}): Promise<string | null> {
  try {
    const client = await getAnthropicForWorkspace(opts.workspaceId);
    const intentHint = {
      completed: "He terminado",
      needs_help: "Necesito tu ayuda con",
      replied: "Te he contestado en",
      failed: "Algo se ha roto en"
    }[opts.intent];
    const resp = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 150,
      system: [
        {
          type: "text",
          text:
            "Eres Sonia hablando con tu jefe por voz. Vas a recibir un comentario interno con markdown, código, IDs técnicos. Tu trabajo: parafrasearlo en UNA frase coloquial natural en español de España, MAX 25 palabras, lista para TTS. Cero markdown, cero emojis, cero IDs (act=..., cuentas, hashes), cero código. Empieza siempre con: \"" +
            intentHint +
            ' <título>". Después una coma y la idea más importante en lenguaje claro y breve.'
        }
      ],
      messages: [
        {
          role: "user",
          content: `TÍTULO TASK: ${opts.taskTitle}\n\nCOMENTARIO ORIGINAL:\n${opts.rawSummary.slice(0, 2000)}\n\nGenera SOLO la frase final, sin comillas ni explicaciones.`
        }
      ]
    });
    const text =
      (resp.content.find((b: any) => b.type === "text") as any)?.text?.trim() ?? "";
    if (!text || text.length < 5) return null;
    return stripMarkdownForSpeech(text).slice(0, 280);
  } catch (e: any) {
    console.warn("[sonia speak] haiku summarize fail:", e?.message);
    return null;
  }
}

/**
 * Lee/escribe la cache de TTS en Workspace.settings.aiAgent.speakCache.
 * Estructura: { [runId+status]: speechText }. Cap 100 entradas, LRU
 * simple por orden de inserción al final.
 */
async function readSpeakCache(workspaceId: string, key: string): Promise<string | null> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { settings: true }
  });
  const c = (ws?.settings as any)?.aiAgent?.speakCache;
  if (!c || typeof c !== "object") return null;
  return typeof c[key] === "string" ? c[key] : null;
}
async function writeSpeakCache(workspaceId: string, key: string, text: string) {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { settings: true }
  });
  const settings: any = ws?.settings ?? {};
  if (!settings.aiAgent) settings.aiAgent = {};
  if (!settings.aiAgent.speakCache) settings.aiAgent.speakCache = {};
  settings.aiAgent.speakCache[key] = text;
  // LRU: si pasa de 100, cortamos las primeras (orden de inserción)
  const keys = Object.keys(settings.aiAgent.speakCache);
  if (keys.length > 100) {
    const toRemove = keys.slice(0, keys.length - 100);
    for (const k of toRemove) delete settings.aiAgent.speakCache[k];
  }
  await prisma.workspace.update({ where: { id: workspaceId }, data: { settings } });
}

export const GET = withApi({ scope: "tasks:read" }, async (req, { api, params }) => {
  const taskId = String((params as any)?.id ?? "");
  if (!taskId) return NextResponse.json({ error: "taskId requerido" }, { status: 400 });

  const task = await prisma.task.findFirst({
    where: { id: taskId, workspaceId: api.workspaceId },
    select: { id: true, title: true }
  });
  if (!task) return NextResponse.json({ error: "task no encontrada" }, { status: 404 });

  const run = await prisma.aiAgentRun.findFirst({
    where: { taskId: task.id, workspaceId: api.workspaceId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      summary: true,
      error: true,
      humanReviewedAt: true,
      updatedAt: true
    }
  });

  // Detectar si Sonia ha contestado en un hilo (último comentario suyo
  // tras humanReviewedAt) para frasear "te he contestado" en lugar de
  // "he terminado".
  const lastComment = await prisma.comment.findFirst({
    where: { targetType: "TASK", targetId: task.id, workspaceId: api.workspaceId },
    orderBy: { createdAt: "desc" },
    select: { authorId: true, body: true, createdAt: true }
  });
  const wsCfg = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { settings: true }
  });
  const aiUserId = (wsCfg?.settings as any)?.aiAgent?.userId as string | undefined;
  const isAiComment = !!lastComment && !!aiUserId && lastComment.authorId === aiUserId;

  const title = (task.title ?? "").trim().slice(0, 90);

  // Determinar intent (qué le decimos) y rawSummary (fuente del extra).
  let intent: "completed" | "needs_help" | "replied" | "failed" = "completed";
  let rawSummary = "";
  let text = "";

  if (!run) {
    text = `Sin novedad en ${title}.`;
  } else if (isAiComment && run.status !== "REQUIRES_HUMAN" && lastComment) {
    intent = "replied";
    rawSummary = lastComment.body ?? "";
  } else {
    switch (run.status) {
      case "SUCCEEDED":
        intent = "completed";
        rawSummary = run.summary ?? "";
        break;
      case "REQUIRES_HUMAN":
        intent = "needs_help";
        rawSummary = run.summary ?? run.error ?? "";
        break;
      case "FAILED":
        intent = "failed";
        rawSummary = run.error ?? "";
        break;
      default:
        text = `Estoy trabajando en ${title}.`;
    }
  }

  // Construir el texto a hablar
  if (!text && run) {
    const cacheKey = `${run.id}:${run.status}`;
    const cached = await readSpeakCache(api.workspaceId, cacheKey);
    if (cached) {
      text = cached;
    } else {
      const cleanRaw = stripMarkdownForSpeech(rawSummary);
      // Si es muy corto, no merece la pena Haiku — frase directa.
      if (cleanRaw.length < 120) {
        const verb = {
          completed: "He terminado",
          needs_help: "Necesito tu ayuda con",
          replied: "Te he contestado en",
          failed: "Algo se ha roto procesando"
        }[intent];
        text = cleanRaw
          ? `${verb} ${title}. ${cleanRaw.slice(0, 180)}`
          : `${verb} ${title}.`;
      } else {
        // Largo o complejo → Haiku resume en 1 frase coloquial.
        const summarized = await haikuSummarize({
          workspaceId: api.workspaceId,
          taskTitle: title,
          rawSummary: cleanRaw,
          intent
        });
        if (summarized) {
          text = summarized;
        } else {
          // Fallback: primera frase del raw + título
          const firstSentence = cleanRaw.split(/(?<=[.!?])\s/)[0] ?? cleanRaw;
          const verb = {
            completed: "He terminado",
            needs_help: "Necesito tu ayuda con",
            replied: "Te he contestado en",
            failed: "Algo se ha roto procesando"
          }[intent];
          text = `${verb} ${title}. ${firstSentence.slice(0, 180)}`;
        }
      }
      // Cache para siguientes polls del mismo run+status
      await writeSpeakCache(api.workspaceId, cacheKey, text).catch(() => {});
    }
  }

  text = stripMarkdownForSpeech(text);
  if (!text) text = `Tengo novedad en ${title}.`;

  try {
    const buf = await elevenlabsSynthesize({
      workspaceId: api.workspaceId,
      text
    });
    const eTag = `"sonia-${run?.id ?? "none"}-${run?.updatedAt?.getTime() ?? 0}"`;
    // El cliente envía If-None-Match → respondemos 304 si coincide.
    const reqEtag = req.headers.get("if-none-match");
    if (reqEtag === eTag) {
      return new NextResponse(null, { status: 304, headers: { ETag: eTag } });
    }
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, max-age=3600",
        ETag: eTag,
        "X-Sonia-Text": encodeURIComponent(text.slice(0, 300))
      }
    });
  } catch (e: any) {
    // ElevenLabs no configurado / falló → 204 para que el cliente caiga
    // al beep sin romper la UX.
    const msg = e?.message ?? String(e);
    return new NextResponse(null, {
      status: 204,
      headers: { "X-Sonia-Voice-Error": encodeURIComponent(msg.slice(0, 200)) }
    });
  }
});
