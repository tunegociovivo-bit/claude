/**
 * OpenAI (imágenes gpt-image y chat ligero). La clave la pone Negocio Vivo en
 * el entorno (OPENAI_API_KEY).
 */
import { AIDisabledError } from "./anthropic";

export async function getOpenAiKeyForWorkspace(_workspaceId: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AIDisabledError("La generación de imágenes con OpenAI no está configurada (falta OPENAI_API_KEY). Avisa a Negocio Vivo.");
  }
  return apiKey;
}

export async function openaiChatCompletion(opts: {
  workspaceId: string;
  model: string;
  prompt: string;
  temperature?: number;
  presencePenalty?: number;
  maxTokens?: number;
  userId?: string | null;
  projectId?: string | null;
  feature?: string;
}): Promise<string> {
  const apiKey = await getOpenAiKeyForWorkspace(opts.workspaceId);
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      messages: [{ role: "user", content: opts.prompt }],
      temperature: opts.temperature ?? 1.0,
      presence_penalty: opts.presencePenalty ?? 0,
      max_tokens: opts.maxTokens ?? 500,
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`OpenAI ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const data = await resp.json();
  const { logAiUsage } = await import("./usage");
  logAiUsage({
    workspaceId: opts.workspaceId,
    userId: opts.userId ?? null,
    projectId: opts.projectId ?? null,
    feature: opts.feature ?? "openai_chat",
    provider: "openai",
    model: opts.model,
    inputTokens: data?.usage?.prompt_tokens ?? 0,
    outputTokens: data?.usage?.completion_tokens ?? 0,
  }).catch(() => {});
  return (data?.choices?.[0]?.message?.content ?? "").trim();
}
