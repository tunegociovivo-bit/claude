/**
 * GET /api/v1/tasks/[id]/sonia-speak
 *
 * Devuelve audio MP3 con Sonia diciendo qué ha pasado con la task.
 * El cliente lo reproduce en lugar del beep cuando notifyMode="voice".
 *
 * El texto se construye desde el último AiAgentRun:
 *   - SUCCEEDED → "He terminado <título>. <primeros chars del summary>"
 *   - REQUIRES_HUMAN → "Necesito tu ayuda con <título>. <error breve>"
 *   - FAILED → "Algo se rompió en <título>"
 *   - SUCCEEDED + último comentario es mío post-revisión → "Te he contestado en <título>"
 *
 * Cache: response tiene Cache-Control max-age=3600 con eTag basado en
 * runId+updatedAt — si el cliente lo pide dos veces para el mismo run
 * golpea el cache del browser, ElevenLabs solo se llama una vez.
 *
 * Si ElevenLabs no está configurado, devolvemos 204 (No Content) —
 * el cliente cae a beep por su cuenta.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { elevenlabsSynthesize } from "@/lib/integrations/elevenlabs";

export const dynamic = "force-dynamic";

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
    select: { id: true, status: true, summary: true, error: true, updatedAt: true }
  });

  // Detectar si Sonia ha contestado en un hilo (último comentario suyo
  // tras humanReviewedAt) para frasear "te he contestado" en lugar de
  // "he terminado".
  const lastComment = await prisma.comment.findFirst({
    where: { targetType: "TASK", targetId: task.id, workspaceId: api.workspaceId },
    orderBy: { createdAt: "desc" },
    select: { authorId: true, body: true }
  });
  const wsCfg = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { settings: true }
  });
  const aiUserId = (wsCfg?.settings as any)?.ai?.userId as string | undefined;
  const isAiComment = !!lastComment && !!aiUserId && lastComment.authorId === aiUserId;

  const title = (task.title ?? "").trim().slice(0, 90);
  let text = "";
  if (!run) {
    text = `Sin novedad en ${title}.`;
  } else if (isAiComment && run.status !== "REQUIRES_HUMAN") {
    text = `Te he contestado en ${title}.`;
  } else {
    switch (run.status) {
      case "SUCCEEDED": {
        const summary = (run.summary ?? "").trim();
        if (summary) {
          // Primera frase del summary o primeros 180 chars.
          const firstSentence = summary.split(/(?<=\.)\s/)[0] ?? summary;
          text = `He terminado ${title}. ${firstSentence.slice(0, 200)}`;
        } else {
          text = `He terminado ${title}.`;
        }
        break;
      }
      case "REQUIRES_HUMAN": {
        const err = (run.error ?? "").trim().slice(0, 140);
        text = err
          ? `Necesito tu ayuda con ${title}. ${err}`
          : `Necesito tu ayuda con ${title}.`;
        break;
      }
      case "FAILED": {
        text = `Algo se ha roto procesando ${title}. Lo he escalado.`;
        break;
      }
      default:
        text = `Estoy trabajando en ${title}.`;
    }
  }

  // Limpieza: quitar markdown básico para que no se lea "asterisco"
  text = text
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/`/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

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
