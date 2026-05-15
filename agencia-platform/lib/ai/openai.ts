/**
 * Cliente OpenAI muy ligero. Llamada HTTP directa (sin SDK) para evitar
 * dependencias pesadas. Suficiente para chat completions.
 *
 * La API key se busca en este orden:
 *   1. Workspace.settings.ai.openaiApiKey (cifrada)
 *   2. process.env.OPENAI_API_KEY
 *
 * Si ninguna está, lanza AIDisabledError.
 */

import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "./crypto";
import { AIDisabledError } from "./anthropic";

export async function getOpenAiKeyForWorkspace(workspaceId: string): Promise<string> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const settings = (ws?.settings as any) ?? {};
  const encrypted: string | undefined = settings?.ai?.openaiApiKey;

  let apiKey: string | null = null;
  if (encrypted) apiKey = decryptSecret(encrypted);
  if (!apiKey) apiKey = process.env.OPENAI_API_KEY ?? null;

  if (!apiKey) {
    throw new AIDisabledError(
      "No hay API key de OpenAI configurada para este workspace. Pégala en /admin/reviews."
    );
  }
  return apiKey;
}

/**
 * Transcribe audio con Whisper. Recibe un Blob/File (lo que llegue de la
 * petición multipart) y devuelve el texto.
 */
export async function transcribeAudioWithWhisper(opts: {
  workspaceId: string;
  audio: Blob;
  filename?: string;
  language?: string;
}): Promise<string> {
  const apiKey = await getOpenAiKeyForWorkspace(opts.workspaceId);
  const form = new FormData();
  form.append("file", opts.audio, opts.filename ?? "audio.webm");
  form.append("model", "whisper-1");
  if (opts.language) form.append("language", opts.language);

  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Whisper ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const data = await resp.json();
  return (data?.text ?? "").trim();
}

export async function openaiChatCompletion(opts: {
  workspaceId: string;
  model: string;
  prompt: string;
  temperature?: number;
  presencePenalty?: number;
  maxTokens?: number;
}): Promise<string> {
  const apiKey = await getOpenAiKeyForWorkspace(opts.workspaceId);
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [{ role: "user", content: opts.prompt }],
      temperature: opts.temperature ?? 1.0,
      presence_penalty: opts.presencePenalty ?? 0,
      max_tokens: opts.maxTokens ?? 500
    })
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`OpenAI ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const data = await resp.json();
  return (data?.choices?.[0]?.message?.content ?? "").trim();
}
