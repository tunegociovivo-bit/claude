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
import { redactMessages, redactPii } from "./pii-redact";
import { completeLive } from "./live-adapters";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type AdapterRequest = { system?: string; messages: ChatMessage[]; maxOutputTokens?: number; capabilities?: Capability[] };

export type AdapterResult = {
  slotId: string;
  provider: ProviderId;
  model: string;
  mode: "shadow" | "live";
  /** ¿Se hizo una llamada REAL a un proveedor? false en shadow; true solo en live. */
  executed: boolean;
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
  // Clamp: entrada no confiable (JSON) podría traer maxOutputTokens negativo/NaN →
  // coste negativo/NaN. Number()||256 neutraliza NaN/0; Math.max(0,·) el negativo.
  const outputTokens = Math.min(Math.max(0, Number(req.maxOutputTokens) || 256), 8192);
  const c = slot.costPer1kUsd ?? { input: 0.003, output: 0.015 };
  const costUsd = round4((inputTokens / 1000) * c.input + (outputTokens / 1000) * c.output);
  return { inputTokens, outputTokens, costUsd };
}

export type CompleteOpts = {
  /** SHADOW: fuerza un fallo de proveedor simulado (para probar breaker/fallback). */
  injectFailure?: string;
  /** LIVE: si true Y hay `keySources` con clave, hace la llamada REAL. Por defecto
   *  false → shadow. El llamante (worker) solo pasa live cuando flag+mode lo permiten. */
  live?: boolean;
  keySources?: KeySources;
  /** Deadline real de la llamada live (AbortController del worker). */
  signal?: AbortSignal;
};

export interface ModelAdapter {
  slot: ModelSlot;
  available(src: KeySources): boolean;
  complete(req: AdapterRequest, opts?: CompleteOpts): Promise<AdapterResult>;
}

export function buildAdapter(slot: ModelSlot): ModelAdapter {
  return {
    slot,
    available: (src) => hasKey(slot, src),
    async complete(req, opts) {
      // Minimización de PII SIEMPRE, antes de simular O de enviar a un proveedor.
      // Redactamos TANTO los mensajes COMO el system prompt (canal influenciable por
      // tenant/atacante): el objeto saneado es el único que cruza la frontera externa.
      const { messages, count } = redactMessages(req.messages);
      const sys = redactPii(req.system);
      const piiRedactions = count + sys.count;
      const safeReq: AdapterRequest = { ...req, messages, system: sys.text || undefined };

      if (opts?.injectFailure) {
        const err: any = new Error(`[shadow:${slot.provider}] ${opts.injectFailure}`);
        err.provider = slot.provider;
        throw err;
      }

      // === LIVE: llamada REAL, solo si se pide explícitamente y hay clave+signal. ===
      if (opts?.live) {
        if (!opts.signal) throw new Error("live requiere un AbortSignal (deadline)");
        if (!hasKey(slot, opts.keySources ?? {})) {
          // Sin clave → unhealthy: NO se finge éxito, se propaga para degradar al siguiente.
          const err: any = new Error(`[live:${slot.provider}] sin clave (unhealthy)`);
          err.provider = slot.provider;
          err.unhealthy = true;
          throw err;
        }
        const wk = opts.keySources?.workspaceKeys as Record<string, string> | undefined;
        const live = await completeLive(slot, safeReq, { keySources: { env: opts.keySources?.env, workspaceKeys: wk }, signal: opts.signal, maxOutputTokens: req.maxOutputTokens });
        return {
          slotId: slot.id,
          provider: slot.provider,
          model: slot.model,
          mode: "live",
          executed: true, // llamada REAL efectuada
          text: live.text,
          usage: live.usage,
          piiRedactions,
          note: "LIVE: llamada real al proveedor."
        };
      }

      // === SHADOW (por defecto): simula, sin red. ===
      const usage = estimate(slot, safeReq);
      return {
        slotId: slot.id,
        provider: slot.provider,
        model: slot.model,
        mode: "shadow",
        executed: false,
        text: `[shadow:${slot.provider}/${slot.model}] respuesta simulada — no se llamó a ningún proveedor externo.`,
        usage,
        piiRedactions,
        note: "SHADOW: sin llamada de red."
      };
    }
  };
}

/**
 * Frontera de EFECTOS externos (A2+): las llamadas de MODELO ya son reales (LIVE),
 * pero ejecutar acciones con efecto — enviar mensajes, publicar, borrar, comprar,
 * pagar, emitir/cobrar facturas, cambios fiscales — NO está implementado y requiere
 * aprobación explícita (A4 fail-closed). Invocar esta frontera LANZA a propósito.
 */
export function liveNotImplemented(): never {
  throw new Error("Ejecución de EFECTOS externos (A2+) no implementada: requiere aprobación (frontera de seguridad). Solo modelo LIVE + shadow.");
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
