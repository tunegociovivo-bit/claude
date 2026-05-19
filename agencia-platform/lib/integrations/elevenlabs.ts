/**
 * Cliente ElevenLabs minimal (TTS) — Fase 48.
 *
 * Genera audio MP3 a partir de texto. Configurado por workspace en
 * settings.integrations.elevenlabs.{ apiKey, voiceId, modelId?,
 * languageCode? }.
 *
 * Voces típicas:
 *   - Spanish female: "21m00Tcm4TlvDq8ikWAM" (Rachel — pero en spanish)
 *   - Tu propia voz clonada: voiceId de tu Voice Library
 *
 * Modelos:
 *   - eleven_turbo_v2_5 (NUEVO default) — soporta language_code
 *     explícito, fuerza la pronunciación al idioma indicado. Antes
 *     teníamos multilingual_v2 que ignora language_code y auto-detecta
 *     mal con voces entrenadas en inglés — el user reportaba "Sonia
 *     pronuncia David como Deivi" porque la voz inglesa interpretaba
 *     el texto con su fonética nativa.
 *   - eleven_multilingual_v2 — sin language_code, auto-detecta del
 *     texto. Funciona OK con voces multi-idioma reales.
 *   - eleven_flash_v2_5 — más rápido, también soporta language_code.
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
    // Default a turbo_v2_5 porque soporta language_code y resuelve
    // el bug de "voz inglesa leyendo español con acento yanqui".
    modelId: cfg.modelId || "eleven_turbo_v2_5",
    languageCode: cfg.languageCode || "es"
  };
}

export async function elevenlabsSynthesize(opts: {
  workspaceId: string;
  text: string;
  voiceId?: string;
  modelId?: string;
  /** ISO 639-1. Default "es". Solo se envía a modelos que lo soportan
   *  (turbo_v2_5, flash_v2_5). multilingual_v2 lo ignora silenciosamente. */
  languageCode?: string;
}): Promise<Buffer> {
  const cfg = await getConfig(opts.workspaceId);
  const voiceId = opts.voiceId || cfg.voiceId;
  const modelId = opts.modelId || cfg.modelId;
  const languageCode = opts.languageCode || cfg.languageCode;
  // Cap defensivo — voice notes muy largas son raras y caras
  const text = opts.text.trim().slice(0, 4000);
  if (!text) throw new Error("text vacío");

  // Solo los modelos turbo_v2_5 / flash_v2_5 aceptan language_code.
  // Los demás revientan con 400 si lo enviamos. Lista permitida:
  const supportsLangCode = /^eleven_(turbo|flash)_v2_5$/.test(modelId);

  const body: any = {
    text,
    model_id: modelId,
    voice_settings: { stability: 0.5, similarity_boost: 0.75 }
  };
  if (supportsLangCode && languageCode) {
    body.language_code = languageCode;
  }

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
      body: JSON.stringify(body),
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
