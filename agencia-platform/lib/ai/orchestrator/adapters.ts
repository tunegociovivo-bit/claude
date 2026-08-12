/**
 * Adaptadores multi-modelo configurables (Slice 2c.2) — OpenAI/Claude/Gemini/
 * Perplexity tras una interfaz común. Claves SERVER-SIDE (env o settings cifrados),
 * NUNCA hardcodeadas ni devueltas al cliente. Minimización de PII antes de nada.
 *
 * MODO SHADOW: `complete()` SIMULA (redacta, estima tokens/coste, devuelve texto
 * simulado) y NO hace ninguna llamada de red. El modo LIVE (llamada externa real)
 * NO está implementado: es la frontera externa ante la que nos detenemos —
 * invocarlo LANZA. Así "seleccionar proveedor alternativo" funciona en simulación
 * sin tocar ningún sistema externo.
 */
import { MODEL_SLOTS, type ModelSlot, type ProviderId, type Capability } from "./providers";
import { redactMessages } from "./pii-redact";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type AdapterRequest = { system?: string; messages: ChatMessage[]; maxOutputTokens?: number; capabilities?: Capability[] };

export type AdapterResult = {
  slotId: string;
  provider: ProviderId;
  model: string;
  mode: "shadow";
  executed: false; // invariante duro en 2c: jamás se ejecuta una llamada real
  text: string | null;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
  piiRedactions: number;
  note?: string;
};

/** Fuentes de credenciales SERVER-SIDE. `workspaceKeys` ya viene descifrado por el
 *  llamante (nunca se descifra ni loguea aquí). Nunca se devuelve el valor. */
export type KeySources = { env?: NodeJS.ProcessEnv; workspaceKeys?: Partial<Record<ProviderId, string>> };

/** ¿Hay clave para el proveedor? (presencia, no el valor). Sin efectos de red. */
export function hasKey(slot: ModelSlot, src: KeySources): boolean {
  const envKey = (src.env ?? process.env)[slot.apiKeyEnv];
  if (envKey && String(envKey).trim()) return true;
  const wk = src.workspaceKeys?.[slot.provider];
  return !!(wk && String(wk).trim());
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** Estima tokens (aprox 4 chars/token) y coste (metadatos del slot). Determinista. */
function estimate(slot: ModelSlot, req: AdapterRequest): { inputTokens: number; outputTokens: number; costUsd: number } {
  const chars = (req.system?.length ?? 0) + req.messages.reduce((s, m) => s + m.content.length, 0);
  const inputTokens = Math.ceil(chars / 4);
  const outputTokens = Math.min(req.maxOutputTokens ?? 256, 8192);
  const c = slot.costPer1kUsd ?? { input: 0.003, output: 0.015 };
  const costUsd = round4((inputTokens / 1000) * c.input + (outputTokens / 1000) * c.output);
  return { inputTokens, outputTokens, costUsd };
}

export interface ModelAdapter {
  slot: ModelSlot;
  available(src: KeySources): boolean;
  /** SHADOW: simula. `injectFailure` permite forzar un fallo de proveedor en tests/
   *  configuración shadow (para probar el circuit breaker y el fallback). */
  complete(req: AdapterRequest, opts?: { injectFailure?: string }): Promise<AdapterResult>;
}

export function buildAdapter(slot: ModelSlot): ModelAdapter {
  return {
    slot,
    available: (src) => hasKey(slot, src),
    async complete(req, opts) {
      // Minimización de PII SIEMPRE, antes incluso de simular.
      const { messages, count } = redactMessages(req.messages);
      const safeReq: AdapterRequest = { ...req, messages, system: req.system };
      if (opts?.injectFailure) {
        // Fallo de proveedor SIMULADO (no hay red). Propaga para que el orquestador
        // diagnostique y pruebe otro proveedor / abra el circuit breaker.
        const err: any = new Error(`[shadow:${slot.provider}] ${opts.injectFailure}`);
        err.provider = slot.provider;
        throw err;
      }
      const usage = estimate(slot, safeReq);
      return {
        slotId: slot.id,
        provider: slot.provider,
        model: slot.model,
        mode: "shadow",
        executed: false,
        text: `[shadow:${slot.provider}/${slot.model}] respuesta simulada — no se llamó a ningún proveedor externo.`,
        usage,
        piiRedactions: count,
        note: "SHADOW: sin llamada de red."
      };
    }
  };
}

/** Frontera externa: la llamada LIVE real NO está implementada en este slice. */
export function liveNotImplemented(): never {
  throw new Error("Integración externa real no implementada (frontera de seguridad Slice 2c). Solo SHADOW.");
}

/** Adaptadores para los slots con clave disponible (server-side). */
export function buildRegistry(src: KeySources): ModelAdapter[] {
  return MODEL_SLOTS.filter((s) => hasKey(s, src)).map(buildAdapter);
}

/** Enruta a los adaptadores disponibles que cumplen la capacidad (orden: coste asc). */
export function routeAdapters(src: KeySources, need: { capabilities?: Capability[]; preferCheap?: boolean; excludeProviders?: ProviderId[] }): ModelAdapter[] {
  const caps = need.capabilities ?? [];
  const out = buildRegistry(src).filter((a) => {
    if (need.excludeProviders?.includes(a.slot.provider)) return false;
    return caps.every((c) => a.slot.capabilities.includes(c));
  });
  if (need.preferCheap) out.sort((a, b) => (a.slot.costPer1kUsd?.output ?? Infinity) - (b.slot.costPer1kUsd?.output ?? Infinity));
  return out;
}
