/**
 * GET /api/v1/leads/queue/[id]/voice.mp3
 * Genera y devuelve la NOTA DE VOZ (ElevenLabs) de un mensaje en cola a partir
 * de su texto, para escucharla en la preview antes de enviar. Si la voz no está
 * configurada, devuelve 400.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { generateVoiceMp3 } from "@/lib/leads/voice-tts";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const msg = await prisma.leadMessage.findFirst({
    where: { id: (params as any).id, workspaceId: api.workspaceId },
    select: { id: true, renderedMessage: true }
  });
  if (!msg) throw new ApiError(404, "not_found", "Mensaje no encontrado");
  const text = (msg.renderedMessage ?? "").trim();
  if (!text) throw new ApiError(400, "no_text", "El mensaje no tiene texto para generar la voz.");

  const audio = await generateVoiceMp3({ workspaceId: api.workspaceId, text });
  if (!audio) {
    throw new ApiError(400, "voice_not_configured", "La voz IA no está configurada (revisa ElevenLabs en Ajustes).");
  }
  return new NextResponse(new Uint8Array(audio), {
    status: 200,
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" }
  });
});
