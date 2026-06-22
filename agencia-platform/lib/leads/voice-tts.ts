/**
 * Generación de notas de voz con ElevenLabs (voz clonada / multilingüe).
 *
 * El texto (ya personalizado por lead) se convierte a audio MP3, que luego
 * sendVoice() reconvierte a opus/ogg para WhatsApp. La key se guarda cifrada en
 * Ajustes (settings.leads.elevenLabsApiKeyEnc) y el voiceId en
 * settings.leads.elevenLabsVoiceId. Best-effort: devuelve null si no hay config
 * o falla (el envío cae a texto para no perder el contacto).
 */
import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/ai/crypto";
import { complete } from "@/lib/ai/anthropic";

type ElevenCfg = { apiKey: string; voiceId: string; speed: number; shorten: boolean; maxSeconds: number };

async function getElevenConfig(workspaceId: string): Promise<ElevenCfg | null> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const s: any = (ws?.settings as any)?.leads ?? {};
  const enc: string | undefined = s.elevenLabsApiKeyEnc;
  const apiKey = (enc ? decryptSecret(enc)?.trim() : (process.env.ELEVENLABS_API_KEY ?? "").trim()) || "";
  const voiceId = (s.elevenLabsVoiceId ?? process.env.ELEVENLABS_VOICE_ID ?? "").trim();
  if (!apiKey || !voiceId) return null;
  // Velocidad ElevenLabs: 0.7–1.2 (1 = normal). Acortado a ~maxSeconds.
  const speed = Math.min(1.2, Math.max(0.7, Number(s.voiceSpeed) || 1.0));
  const shorten = s.voiceShorten !== false; // por defecto sí
  const maxSeconds = Math.min(60, Math.max(8, Number(s.voiceMaxSeconds) || 18));
  return { apiKey, voiceId, speed, shorten, maxSeconds };
}

export async function elevenConfigured(workspaceId: string): Promise<boolean> {
  return (await getElevenConfig(workspaceId)) !== null;
}

// Caché del guion condensado (evita re-llamar a la IA al re-escuchar/enviar).
const condenseCache = new Map<string, { at: number; text: string }>();
const CONDENSE_TTL = 6 * 60 * 60 * 1000;

/** Reescribe el texto como guion de nota de voz corto y al grano (≈maxSeconds). */
async function condenseForVoice(workspaceId: string, text: string, maxSeconds: number): Promise<string> {
  const words = Math.max(20, Math.round(maxSeconds * 2.6)); // ~2.6 palabras/seg
  // Si ya es corto, no gastamos IA.
  if (text.split(/\s+/).length <= words) return text;
  const key = `${maxSeconds}:${text}`;
  const hit = condenseCache.get(key);
  if (hit && Date.now() - hit.at < CONDENSE_TTL) return hit.text;
  try {
    const out = await complete({
      workspaceId,
      model: "claude-haiku-4-5-20251001",
      system: `Reescribe el mensaje como GUION de una nota de voz de WhatsApp en español de España.
Reglas: ve AL GRANO, máximo ~${words} palabras (≈${maxSeconds} segundos hablados), tono cercano y natural,
conserva el nombre del negocio si aparece, una sola propuesta clara y una CTA breve al final. Sin emojis,
sin asteriscos, sin URLs largas. Devuelve SOLO el texto del guion.`,
      user: text,
      maxTokens: 300,
      feature: "voice_condense"
    });
    const t = out.trim() || text;
    condenseCache.set(key, { at: Date.now(), text: t });
    return t;
  } catch {
    return text;
  }
}

/** Genera la nota de voz (MP3) para un texto. null si no hay config o falla. */
export async function generateVoiceMp3(opts: { workspaceId: string; text: string }): Promise<Buffer | null> {
  let text = (opts.text ?? "").trim();
  if (!text) return null;
  const cfg = await getElevenConfig(opts.workspaceId);
  if (!cfg) return null;
  if (cfg.shorten) text = await condenseForVoice(opts.workspaceId, text, cfg.maxSeconds);
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(cfg.voiceId)}`, {
      method: "POST",
      headers: {
        "xi-api-key": cfg.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg"
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: cfg.speed }
      }),
      signal: AbortSignal.timeout(30000)
    });
    if (!r.ok) {
      console.error("[voice-tts] ElevenLabs", r.status, (await r.text().catch(() => "")).slice(0, 160));
      return null;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length > 0 ? buf : null;
  } catch (e: any) {
    console.error("[voice-tts] error:", e?.message ?? e);
    return null;
  }
}
