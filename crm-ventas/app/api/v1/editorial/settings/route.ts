/**
 * Configuración del módulo editorial del negocio.
 *
 * En el Hub este endpoint guardaba el webhook de Make, la API key de Freepik
 * y el modelo de imagen por defecto. En el CRM las claves las pone Negocio
 * Vivo en el entorno, así que:
 *  · GET  → qué capacidades de IA están disponibles (sin revelar claves) y el
 *           modelo de imagen por defecto que usa la generación.
 *  · PATCH (solo administradores) → modelo de imagen por defecto
 *           (settings.editorial.imageModel, lo lee generate-image). La UI del
 *           negocio no lo muestra; queda para soporte de Negocio Vivo.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { patchWorkspaceSettings, readWorkspaceSettings } from "@/lib/content/settings";

function availability() {
  const text = Boolean(process.env.ANTHROPIC_API_KEY);
  const openai = Boolean(process.env.OPENAI_API_KEY);
  const freepik = Boolean(process.env.FREEPIK_API_KEY);
  return {
    text,
    images: openai || freepik,
    imageEditing: openai,
    // El vídeo genera las tomas con gpt-image-2 y las anima con Freepik/Kling.
    video: openai && freepik,
    voice: Boolean(process.env.ELEVENLABS_API_KEY),
    subtitles: openai
  };
}

export const GET = withApi({ module: "editorial" }, async (_req, { api }) => {
  const settings = await readWorkspaceSettings(api.workspaceId);
  return NextResponse.json({
    imageModel: settings?.editorial?.imageModel ?? "openai-gpt-image-1",
    availability: availability(),
    canManage: api.role === "ADMIN"
  });
});

const schema = z.object({
  imageModel: z.enum(["openai-gpt-image-1", "freepik-seedream-v4"])
});

export const PATCH = withApi({ module: "editorial", admin: true, rate: "admin" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  if (parsed.data.imageModel.startsWith("freepik") && !process.env.FREEPIK_API_KEY) {
    throw new ApiError(400, "freepik_unavailable", "La generación con Freepik no está disponible; avisa a Negocio Vivo.");
  }
  await patchWorkspaceSettings(api.workspaceId, (settings) => {
    settings.editorial = { ...(settings.editorial ?? {}), imageModel: parsed.data.imageModel };
  });
  return NextResponse.json({ ok: true });
});
