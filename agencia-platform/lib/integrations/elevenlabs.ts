/**
 * Cliente ElevenLabs minimal (TTS) — Fase 48.
 *
 * Genera audio MP3 a partir de texto. Configurado por workspace en
 * settings.integrations.elevenlabs.{ apiKey, voiceId, modelId? }.
 *
 * Voces típicas:
 *   - Spanish female: "21m00Tcm4TlvDq8ikWAM" (Rachel — pero en spanish)
 *   - Tu propia voz clonada: voiceId de tu Voice Library
 * Modelos:
 *   - eleven_multilingual_v2 (default) — soporta español natural
 *   - eleven_turbo_v2_5 (más rápido, menor calidad)
 */

import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/ai/crypto";

const BASE = "https://api.elevenlabs.io/v1";

async function getConfig(workspaceId: string) {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const cfg = (ws?.settings as any)?.integrations?.elevenlabs ?? {};
  if (!cfg.apiKey) throw new Error("ElevenLabs no configurado");
  const apiKey = decryptSecret(cfg.apiKey);
  if (!apiKey) throw new Error("ElevenLabs key inválida");
  return {
    apiKey,
    voiceId: cfg.voiceId || "21m00Tcm4TlvDq8ikWAM",
    modelId: cfg.modelId || "eleven_multilingual_v2"
  };
}

export async function elevenlabsSynthesize(opts: {
  workspaceId: string;
  text: string;
  voiceId?: string;
  modelId?: string;
}): Promise<Buffer> {
  const cfg = await getConfig(opts.workspaceId);
  const voiceId = opts.voiceId || cfg.voiceId;
  const modelId = opts.modelId || cfg.modelId;
  // Cap defensivo — voice notes muy largas son raras y caras
  const text = opts.text.trim().slice(0, 4000);
  if (!text) throw new Error("text vacío");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const resp = await fetch(`${BASE}/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": cfg.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg"
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      }),
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(`ElevenLabs ${resp.status}: ${t.slice(0, 200)}`);
    }
    return Buffer.from(await resp.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

export async function elevenlabsTest(workspaceId: string): Promise<{ ok: true; voiceCount: number }> {
  const cfg = await getConfig(workspaceId);
  const resp = await fetch(`${BASE}/voices`, {
    headers: { "xi-api-key": cfg.apiKey }
  });
  if (!resp.ok) throw new Error(`ElevenLabs test ${resp.status}`);
  const data = await resp.json();
  return { ok: true, voiceCount: (data.voices ?? []).length };
}
