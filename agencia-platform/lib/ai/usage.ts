/**
 * Tracking de uso de IA por workspace/usuario/proyecto.
 * Se llama desde lib/ai/anthropic.ts y lib/ai/openai.ts después de cada
 * llamada exitosa para registrar tokens consumidos y coste estimado.
 *
 * Pricing: USD por 1M tokens (input/output) según public pricing pages
 * a fecha de mayo 2026. Si el modelo no aparece en la tabla, se asume
 * 1 USD/M input y 5 USD/M output (estimación conservadora).
 */

import { prisma } from "@/lib/db/prisma";

const USD_TO_MICROS = 1_000_000;

// Precios en USD por 1M tokens. (input, output)
const MODEL_PRICING: Record<string, [number, number]> = {
  // Anthropic Claude family
  "claude-opus-4-7": [15, 75],
  "claude-opus-4-6": [15, 75],
  "claude-opus-4-5": [15, 75],
  "claude-sonnet-4-7": [3, 15],
  "claude-sonnet-4-6": [3, 15],
  "claude-sonnet-4-5": [3, 15],
  "claude-haiku-4-5": [1, 5],
  // OpenAI chat
  "gpt-4o-mini": [0.15, 0.6],
  "gpt-4o": [2.5, 10],
  "gpt-4-turbo": [10, 30],
  // OpenAI Whisper = USD 0.006 / minuto. No es por token; lo metemos como
  // outputTokens en segundos × pricing aproximado. Aquí 6/M asumiendo
  // que loggemos segundos en outputTokens (override en logTranscription).
  "whisper-1": [0, 6]
};

export function estimateCostMicros(model: string, inputTokens: number, outputTokens: number): number {
  const [inputPerM, outputPerM] = MODEL_PRICING[model] ?? [1, 5];
  const usd = (inputTokens / 1_000_000) * inputPerM + (outputTokens / 1_000_000) * outputPerM;
  return Math.round(usd * USD_TO_MICROS);
}

export async function logAiUsage(opts: {
  workspaceId: string;
  userId?: string | null;
  projectId?: string | null;
  feature: string;
  provider: "anthropic" | "openai";
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}): Promise<void> {
  const input = opts.inputTokens ?? 0;
  const output = opts.outputTokens ?? 0;
  const costMicros = estimateCostMicros(opts.model, input, output);
  try {
    await prisma.aiUsage.create({
      data: {
        workspaceId: opts.workspaceId,
        userId: opts.userId ?? null,
        projectId: opts.projectId ?? null,
        feature: opts.feature,
        provider: opts.provider,
        model: opts.model,
        inputTokens: input,
        outputTokens: output,
        costMicros
      }
    });
  } catch (e) {
    // No bloqueamos la respuesta al usuario si el log falla
    console.warn("[ai-usage] log fallo:", (e as Error).message);
  }
}

/**
 * Para Whisper: en lugar de tokens, pasa segundos como outputTokens.
 * Internamente trata "tokens" como segundos al calcular coste:
 *  cost = segundos * 0.006 USD / 60
 */
export async function logTranscriptionUsage(opts: {
  workspaceId: string;
  userId?: string | null;
  projectId?: string | null;
  feature: string;
  seconds: number;
}): Promise<void> {
  const usd = (opts.seconds * 0.006) / 60;
  const costMicros = Math.round(usd * USD_TO_MICROS);
  try {
    await prisma.aiUsage.create({
      data: {
        workspaceId: opts.workspaceId,
        userId: opts.userId ?? null,
        projectId: opts.projectId ?? null,
        feature: opts.feature,
        provider: "openai",
        model: "whisper-1",
        inputTokens: 0,
        outputTokens: opts.seconds,
        costMicros
      }
    });
  } catch (e) {
    console.warn("[ai-usage] log transcription fallo:", (e as Error).message);
  }
}
