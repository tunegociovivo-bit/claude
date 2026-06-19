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

async function getElevenConfig(workspaceId: string): Promise<{ apiKey: string; voiceId: string } | null> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const s: any = (ws?.settings as any)?.leads ?? {};
  const enc: string | undefined = s.elevenLabsApiKeyEnc;
  const apiKey = (enc ? decryptSecret(enc)?.trim() : (process.env.ELEVENLABS_API_KEY ?? "").trim()) || "";
  const voiceId = (s.elevenLabsVoiceId ?? process.env.ELEVENLABS_VOICE_ID ?? "").trim();
  if (!apiKey || !voiceId) return null;
  return { apiKey, voiceId };
}

export async function elevenConfigured(workspaceId: string): Promise<boolean> {
  return (await getElevenConfig(workspaceId)) !== null;
}

/** Genera la nota de voz (MP3) para un texto. null si no hay config o falla. */
export async function generateVoiceMp3(opts: { workspaceId: string; text: string }): Promise<Buffer | null> {
  const text = (opts.text ?? "").trim();
  if (!text) return null;
  const cfg = await getElevenConfig(opts.workspaceId);
  if (!cfg) return null;
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
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
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
