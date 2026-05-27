/**
 * POST /api/v1/sonia-chat/voice
 *
 * Transcribe audio (webm/mp3/etc) usando Whisper + el OpenAI key del
 * workspace de la sesión. Específico para el chat con Sonia — el
 * endpoint público /voice/transcribe requiere un slug de negocio.
 *
 * Body: multipart con campo "audio" (Blob).
 * Respuesta: { text: string }
 */

import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { transcribeAudioWithWhisper } from "@/lib/ai/openai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 20 * 1024 * 1024; // 20MB tope (Whisper soporta 25MB)

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const form = await req.formData().catch(() => null);
  if (!form) throw new ApiError(400, "bad_request", "Falta multipart form-data");
  const audio = form.get("audio");
  if (!(audio instanceof Blob)) {
    throw new ApiError(400, "missing_audio", "Falta el blob 'audio'");
  }
  if (audio.size > MAX_BYTES) {
    throw new ApiError(413, "too_large", `Audio >${MAX_BYTES} bytes`);
  }
  try {
    const text = await transcribeAudioWithWhisper({
      workspaceId: api.workspaceId,
      audio,
      filename: (audio as any).name ?? "voice.webm",
      language: "es"
    });
    return NextResponse.json({ text: text.trim() });
  } catch (e: any) {
    return NextResponse.json(
      { error: { code: "whisper_error", message: String(e?.message ?? e).slice(0, 300) } },
      { status: 502 }
    );
  }
});
