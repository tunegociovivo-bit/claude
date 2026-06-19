/**
 * POST /api/v1/leads/voice/test
 *
 * Genera una nota de voz de muestra con la config de ElevenLabs guardada
 * (key + Voice ID en Ajustes) para validar que suena bien. Devuelve el audio
 * en base64 para que el navegador lo reproduzca al instante. Solo admins.
 *
 * Body opcional: { text?: string }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { generateVoiceMp3 } from "@/lib/leads/voice-tts";

const SAMPLE = "¡Hola! Soy tu asistente de Negocio Vivo. Así sonarán tus notas de voz personalizadas para cada cliente.";

const schema = z.object({ text: z.string().max(500).optional() });

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  const me = await prisma.membership.findFirst({ where: { workspaceId: api.workspaceId, userId: api.userId } });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins");

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  const text = (parsed.success ? parsed.data.text?.trim() : "") || SAMPLE;

  const audio = await generateVoiceMp3({ workspaceId: api.workspaceId, text });
  if (!audio) {
    throw new ApiError(
      400,
      "voice_not_ready",
      "No se pudo generar la voz. Revisa la API key de ElevenLabs y el Voice ID en Ajustes (y guarda antes de probar)."
    );
  }
  return NextResponse.json({ ok: true, audioBase64: audio.toString("base64") });
});
