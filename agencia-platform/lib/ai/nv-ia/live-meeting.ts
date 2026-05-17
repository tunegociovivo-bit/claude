/**
 * Procesamiento "live mode" para videollamadas (Φ5).
 *
 * Cada vez que llega un chunk de audio:
 *   1. Whisper transcribe el chunk
 *   2. Concatenamos al fullTranscript de la sesión
 *   3. Si ha pasado >20s desde el último procesamiento Y hay
 *      suficiente texto nuevo, llamamos a Claude en modo
 *      "asistente en vivo" — devuelve hasta 5 sugerencias breves
 *      estructuradas (action_item, info_lookup, tone_alert,
 *      search_suggestion).
 *   4. Persistimos las sugerencias en suggestionsLog y devolvemos
 *      las NUEVAS al cliente.
 *
 * Coste controlado: solo procesamos cada 20s, solo si hay >50 chars
 * nuevos desde el último tick. Un meeting de 45min → ~135 chunks
 * (cada 20s) → ~$0.50 en LLM, comparable a una llamada normal.
 */

import { complete } from "@/lib/ai/anthropic";

const PROCESS_THROTTLE_SECONDS = 20;
const MIN_NEW_CHARS = 50;

export type LiveSuggestion = {
  type: "action_item" | "info_lookup" | "tone_alert" | "search_suggestion" | "decision_point";
  title: string;
  body?: string;
  /** 0-10. Mayor = más urgente/útil para mostrar arriba. */
  relevance: number;
};

const SYSTEM_PROMPT = `Eres Sonia en MODO ASISTENTE EN VIVO durante una videollamada. Te llega la transcripción reciente (últimos 1-2 minutos) y debes devolver UN JSON con sugerencias ÚTILES y BREVES que puedan ayudar al asistente humano en tiempo real.

Tipos de sugerencias:
- "action_item": acción acordada o pedida que deberá crearse como tarea. body con detalle.
- "info_lookup": dato que se mencionó y conviene buscar (cliente, contrato, persona). body con el query.
- "tone_alert": si detectas tono problemático (cliente molesto, confusión, evasiva). body breve.
- "search_suggestion": tema o referencia que merece búsqueda extra. body con el query.
- "decision_point": momento donde se está tomando una decisión importante. body con resumen.

REGLAS:
- Solo devuelve sugerencias REALMENTE útiles. Si no hay nada destacable, devuelve [].
- Máximo 5 sugerencias por procesamiento.
- relevance 0-10 — solo >=6 valen la pena.
- title <= 60 chars. body <= 200 chars.
- NO inventes datos. Si solo escuchas "el cliente Acme", el lookup es "Acme"; no añadas info que no está en la transcripción.
- NO repitas sugerencias casi idénticas a las del prevSuggestions.

OUTPUT: SOLO JSON con shape { "suggestions": [{ type, title, body?, relevance }, ...] }. Sin texto antes/después.`;

export async function processLiveChunk(opts: {
  workspaceId: string;
  fullTranscript: string;
  newChunkText: string;
  prevSuggestions: LiveSuggestion[];
  lastProcessedAt: Date | null;
}): Promise<{
  processed: boolean;
  suggestions: LiveSuggestion[];
  reason?: string;
}> {
  if (!opts.newChunkText.trim()) {
    return { processed: false, suggestions: [], reason: "chunk vacío" };
  }
  if (opts.newChunkText.length < MIN_NEW_CHARS) {
    return { processed: false, suggestions: [], reason: "chunk corto" };
  }
  if (opts.lastProcessedAt) {
    const elapsed = (Date.now() - opts.lastProcessedAt.getTime()) / 1000;
    if (elapsed < PROCESS_THROTTLE_SECONDS) {
      return { processed: false, suggestions: [], reason: "throttle" };
    }
  }

  // Cogemos los últimos ~2500 chars del transcript para dar contexto
  // sin pasar el chunk nuevo
  const recentTranscript = opts.fullTranscript.slice(-2500);
  const prevTitles = opts.prevSuggestions.slice(-15).map((s) => s.title);

  const user =
    `Transcripción reciente (incluye lo último que se acaba de decir):\n---\n${recentTranscript}\n---\n\n` +
    `Sugerencias YA dadas en esta sesión (no repitas estos titles):\n${prevTitles.length ? prevTitles.join(" | ") : "(ninguna)"}\n\n` +
    `Devuelve JSON con suggestions.`;

  try {
    const resp = await complete({
      workspaceId: opts.workspaceId,
      system: SYSTEM_PROMPT,
      user,
      maxTokens: 1000,
      feature: "nv-ia-live-meeting"
    });
    // Parse defensivo
    const m = resp.match(/\{[\s\S]*\}/);
    if (!m) return { processed: true, suggestions: [] };
    const parsed = JSON.parse(m[0]);
    if (!parsed?.suggestions || !Array.isArray(parsed.suggestions)) {
      return { processed: true, suggestions: [] };
    }
    const cleaned = parsed.suggestions
      .filter((s: any) => s && typeof s.title === "string" && typeof s.relevance === "number")
      .map((s: any) => ({
        type: ["action_item", "info_lookup", "tone_alert", "search_suggestion", "decision_point"].includes(s.type)
          ? s.type
          : "search_suggestion",
        title: String(s.title).slice(0, 80),
        body: s.body ? String(s.body).slice(0, 240) : undefined,
        relevance: Math.max(0, Math.min(10, Number(s.relevance)))
      }))
      .filter((s: any) => s.relevance >= 6)
      .slice(0, 5);
    return { processed: true, suggestions: cleaned };
  } catch (e) {
    return { processed: true, suggestions: [], reason: `claude error: ${(e as Error).message}` };
  }
}
