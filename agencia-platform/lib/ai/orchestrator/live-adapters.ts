/**
 * Adaptadores LIVE reales por proveedor (G4) — OpenAI / Anthropic / Gemini /
 * Perplexity tras una interfaz común. Hacen una llamada HTTP REAL a la API oficial
 * documentada, con estas garantías DURAS:
 *
 *  - Claves SIEMPRE server-side (env o `workspaceKeys` ya descifradas por el llamante);
 *    nunca se registran, nunca se devuelven, nunca aparecen en el resultado.
 *  - PII minimizada ANTES de enviar (system + mensajes redactados por el llamante en
 *    `adapters.complete`; aquí se asume ya saneado y no se vuelve a loguear).
 *  - `AbortSignal` obligatorio → deadline real; una llamada colgada se cancela.
 *  - Validación ESTRICTA de la respuesta: si el shape no es el esperado, se LANZA
 *    `InvalidProviderResponse` (nunca se finge éxito ni texto vacío como válido).
 *  - Uso/coste REALES: tokens de la respuesta del proveedor × pricing del slot.
 *  - Si falta la key → el proveedor es unhealthy y NI SIQUIERA se llega aquí (el
 *    registro lo filtra); si aun así se invoca sin key, se lanza `MissingProviderKey`.
 *
 * Errores de red/proveedor se clasifican (`retryableStatus`, `ProviderHttpError` con
 * `retryAfterMs`) para que el orquestador aplique backoff/breaker/failover.
 */
import type { ModelSlot } from "./providers";
import type { AdapterRequest } from "./adapters";

export class MissingProviderKey extends Error {
  constructor(public provider: string) {
    super(`Sin clave para el proveedor ${provider}: unhealthy, no se llama.`);
    this.name = "MissingProviderKey";
  }
}
export class InvalidProviderResponse extends Error {
  constructor(public provider: string, detail: string) {
    super(`Respuesta inválida de ${provider}: ${detail}`);
    this.name = "InvalidProviderResponse";
  }
}
export class ProviderHttpError extends Error {
  constructor(public provider: string, public status: number, public retryAfterMs: number | null, public retryable: boolean) {
    super(`HTTP ${status} de ${provider}`);
    this.name = "ProviderHttpError";
  }
}

export type LiveUsage = { inputTokens: number; outputTokens: number; costUsd: number };
export type LiveResult = { provider: string; model: string; text: string; usage: LiveUsage; raw: { finishReason?: string } };

/** Endpoints oficiales (documentados). Sin SDK: fetch directo → menos superficie. */
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
function cost(slot: ModelSlot, inTok: number, outTok: number): number {
  const c = slot.costPer1kUsd ?? { input: 0, output: 0 };
  return round4((inTok / 1000) * c.input + (outTok / 1000) * c.output);
}
/** 429/500/502/503/504 son reintentables; el resto (401/400/403/404) no. */
export function retryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}
/** Parsea Retry-After (segundos o fecha HTTP) → ms, acotado. `nowMs` inyectable. */
export function parseRetryAfter(header: string | null | undefined, nowMs: number): number | null {
  if (!header) return null;
  const s = header.trim();
  if (/^\d+$/.test(s)) return Math.min(Number(s) * 1000, 300_000);
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return Math.max(0, Math.min(t - nowMs, 300_000));
  return null;
}

type FetchLike = typeof fetch;

/** Resuelve la key server-side. NUNCA la devuelve al llamante ni la loguea. */
function resolveKey(slot: ModelSlot, sources: { env?: NodeJS.ProcessEnv; workspaceKeys?: Record<string, string> }): string | null {
  const env = sources.env ?? process.env;
  const fromEnv = env[slot.apiKeyEnv];
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim();
  const wk = sources.workspaceKeys?.[slot.provider];
  return wk && String(wk).trim() ? String(wk).trim() : null;
}

/** Construye el body por proveedor (formato oficial). El caller ya redactó PII. */
function buildBody(slot: ModelSlot, req: AdapterRequest, maxOut: number): { url: string; headers: Record<string, string>; body: any } {
  const sys = req.system?.trim() || undefined;
  const msgs = req.messages.map((m) => ({ role: m.role, content: m.content }));
  switch (slot.provider) {
    case "openai":
      return {
        url: "https://api.openai.com/v1/chat/completions",
        headers: { "content-type": "application/json", authorization: `Bearer __KEY__` },
        body: { model: slot.model, max_tokens: maxOut, messages: sys ? [{ role: "system", content: sys }, ...msgs] : msgs }
      };
    case "perplexity":
      return {
        url: "https://api.perplexity.ai/chat/completions",
        headers: { "content-type": "application/json", authorization: `Bearer __KEY__` },
        body: { model: slot.model, max_tokens: maxOut, messages: sys ? [{ role: "system", content: sys }, ...msgs] : msgs }
      };
    case "anthropic":
      return {
        url: "https://api.anthropic.com/v1/messages",
        headers: { "content-type": "application/json", "x-api-key": "__KEY__", "anthropic-version": "2023-06-01" },
        body: { model: slot.model, max_tokens: maxOut, system: sys, messages: msgs.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })) }
      };
    case "gemini":
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${slot.model}:generateContent`,
        headers: { "content-type": "application/json", "x-goog-api-key": "__KEY__" },
        body: {
          systemInstruction: sys ? { parts: [{ text: sys }] } : undefined,
          generationConfig: { maxOutputTokens: maxOut },
          contents: msgs.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }))
        }
      };
    default:
      throw new InvalidProviderResponse(slot.provider, "proveedor no soportado");
  }
}

/** Extrae texto + tokens de la respuesta, VALIDANDO estrictamente el shape. */
function parseResponse(slot: ModelSlot, json: any): { text: string; inTok: number; outTok: number; finishReason?: string } {
  try {
    switch (slot.provider) {
      case "openai":
      case "perplexity": {
        const choice = json?.choices?.[0];
        const text = choice?.message?.content;
        if (typeof text !== "string" || !text.trim()) throw new Error("choices[0].message.content vacío");
        return { text, inTok: Number(json?.usage?.prompt_tokens) || 0, outTok: Number(json?.usage?.completion_tokens) || 0, finishReason: choice?.finish_reason };
      }
      case "anthropic": {
        const block = Array.isArray(json?.content) ? json.content.find((b: any) => b?.type === "text") : null;
        const text = block?.text;
        if (typeof text !== "string" || !text.trim()) throw new Error("content[].text vacío");
        return { text, inTok: Number(json?.usage?.input_tokens) || 0, outTok: Number(json?.usage?.output_tokens) || 0, finishReason: json?.stop_reason };
      }
      case "gemini": {
        const cand = json?.candidates?.[0];
        const text = cand?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";
        if (typeof text !== "string" || !text.trim()) throw new Error("candidates[0].content.parts vacío");
        return { text, inTok: Number(json?.usageMetadata?.promptTokenCount) || 0, outTok: Number(json?.usageMetadata?.candidatesTokenCount) || 0, finishReason: cand?.finishReason };
      }
      default:
        throw new Error("proveedor no soportado");
    }
  } catch (e: any) {
    throw new InvalidProviderResponse(slot.provider, String(e?.message ?? e));
  }
}

/**
 * Llamada LIVE real. `signal` (deadline) obligatorio. Lanza en: sin key, HTTP no-OK
 * (con clasificación retryable + retryAfterMs), o respuesta inválida. NUNCA finge
 * éxito. `deps.fetch`/`deps.now` inyectables para test sin red.
 */
export async function completeLive(
  slot: ModelSlot,
  req: AdapterRequest,
  opts: { keySources: { env?: NodeJS.ProcessEnv; workspaceKeys?: Record<string, string> }; signal: AbortSignal; maxOutputTokens?: number },
  deps: { fetch?: FetchLike; now?: () => number } = {}
): Promise<LiveResult> {
  const key = resolveKey(slot, opts.keySources);
  if (!key) throw new MissingProviderKey(slot.provider); // unhealthy → degradar, no fingir

  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? (() => Date.now());
  const maxOut = Math.min(Math.max(1, Math.floor(Number(opts.maxOutputTokens) || 512)), 8192);
  const { url, headers, body } = buildBody(slot, req, maxOut);
  // Inserta la key en el header correcto SIN que quede en ninguna estructura logueable.
  const finalHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) finalHeaders[k] = v === "__KEY__" ? key : v.replace("__KEY__", key);

  let res: Response;
  try {
    res = await doFetch(url, { method: "POST", headers: finalHeaders, body: JSON.stringify(body), signal: opts.signal });
  } catch (e: any) {
    // Abort (deadline) o error de red → tratable como transitorio por el orquestador.
    throw new ProviderHttpError(slot.provider, 0, null, true);
  }
  if (!res.ok) {
    const retryAfterMs = parseRetryAfter(res.headers?.get?.("retry-after"), now());
    throw new ProviderHttpError(slot.provider, res.status, retryAfterMs, retryableStatus(res.status));
  }
  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new InvalidProviderResponse(slot.provider, "cuerpo no-JSON");
  }
  const { text, inTok, outTok, finishReason } = parseResponse(slot, json);
  return { provider: slot.provider, model: slot.model, text, usage: { inputTokens: inTok, outputTokens: outTok, costUsd: cost(slot, inTok, outTok) }, raw: { finishReason } };
}
