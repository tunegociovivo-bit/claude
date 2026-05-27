/**
 * POST /api/v1/extension/live-meeting/chunk
 * multipart: audio (Blob), sessionId
 *
 * 1) Whisper transcribe el chunk.
 * 2) Append al fullTranscript de la sesión.
 * 3) processLiveChunk con throttling — solo llama a Claude cada 20s.
 * 4) Devuelve las sugerencias NUEVAS al cliente.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { transcribeAudioWithWhisper } from "@/lib/ai/openai";
import { processLiveChunk, type LiveSuggestion } from "@/lib/ai/nv-ia/live-meeting";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10MB

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError(400, "bad_multipart", "multipart/form-data esperado");
  }
  const audio = form.get("audio");
  const sessionId = String(form.get("sessionId") ?? "").trim();
  if (!sessionId) throw new ApiError(400, "no_session", "Falta sessionId");
  if (!(audio instanceof Blob)) throw new ApiError(400, "no_audio", "Falta audio");
  if (audio.size === 0) return NextResponse.json({ ok: true, skipped: "empty" });
  if (audio.size > MAX_AUDIO_BYTES) {
    throw new ApiError(413, "too_large", `chunk demasiado grande (${audio.size}B > ${MAX_AUDIO_BYTES})`);
  }

  const session = await prisma.liveMeetingSession.findFirst({
    where: { id: sessionId, workspaceId: api.workspaceId }
  });
  if (!session) throw new ApiError(404, "not_found", "Sesión no encontrada");
  if (session.status !== "LIVE") {
    return NextResponse.json({ ok: false, error: "Sesión no está LIVE", status: session.status });
  }

  // 1. Whisper transcribe
  let transcript: string;
  try {
    transcript = await transcribeAudioWithWhisper({
      workspaceId: api.workspaceId,
      audio,
      filename: `live-chunk-${Date.now()}.webm`,
      language: "es"
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: `Whisper falló: ${e?.message ?? e}`,
      retryable: true
    });
  }

  const chunkText = transcript.trim();
  const newFullTranscript = session.fullTranscript + (session.fullTranscript ? " " : "") + chunkText;

  // 2. Procesar con Claude (con throttling)
  const prevSuggestions = (session.suggestionsLog as any[])?.flatMap(
    (entry: any) => entry?.suggestions ?? []
  ) ?? [];

  const result = await processLiveChunk({
    workspaceId: api.workspaceId,
    fullTranscript: newFullTranscript,
    newChunkText: chunkText,
    prevSuggestions,
    lastProcessedAt: session.lastProcessedAt
  });

  // 3. Persistir
  const newEntry = result.processed
    ? {
        ts: new Date().toISOString(),
        chunkIdx: session.chunksReceived + 1,
        transcript: chunkText,
        suggestions: result.suggestions
      }
    : null;

  await prisma.liveMeetingSession.update({
    where: { id: sessionId },
    data: {
      fullTranscript: newFullTranscript,
      chunksReceived: { increment: 1 },
      ...(result.processed
        ? {
            lastProcessedAt: new Date(),
            suggestionsLog: {
              push: newEntry
            } as any
          }
        : {})
    }
  });

  return NextResponse.json({
    ok: true,
    transcriptChunk: chunkText,
    processed: result.processed,
    suggestions: result.suggestions,
    reason: result.reason
  });
});
