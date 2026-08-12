/**
 * G4 — adaptadores LIVE reales con fetch MOCKEADO (jamás red real). Verifica:
 * llamada real por proveedor, claves server-side que nunca se filtran, uso/coste
 * reales, validación estricta de salida, 429/Retry-After, abort/deadline, y que sin
 * clave se degrada (unhealthy) en vez de fingir éxito.
 */
import { describe, it, expect, vi } from "vitest";
import { completeLive, parseRetryAfter, retryableStatus, MissingProviderKey, InvalidProviderResponse, ProviderHttpError } from "../live-adapters";
import { buildAdapter } from "../adapters";
import { MODEL_SLOTS } from "../providers";

const slot = (p: string) => MODEL_SLOTS.find((s) => s.provider === p)!;
const req = { messages: [{ role: "user" as const, content: "hola" }], system: "eres útil" };
const okSignal = new AbortController().signal;

function mockFetch(status: number, json: any, headers: Record<string, string> = {}) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => json
  })) as any;
}

describe("parseRetryAfter / retryableStatus", () => {
  it("segundos y fecha; acota a 300s", () => {
    expect(parseRetryAfter("2", 0)).toBe(2000);
    expect(parseRetryAfter("100000", 0)).toBe(300_000);
    expect(parseRetryAfter(null, 0)).toBeNull();
    expect(parseRetryAfter("Wed, 21 Oct 2099 07:28:00 GMT", 0)).toBe(300_000);
  });
  it("clasifica retryable", () => {
    expect(retryableStatus(429)).toBe(true);
    expect(retryableStatus(503)).toBe(true);
    expect(retryableStatus(401)).toBe(false);
    expect(retryableStatus(400)).toBe(false);
  });
});

describe("completeLive — llamada real (fetch mock)", () => {
  it("OpenAI: parsea texto+usage, calcula coste real, NO filtra la clave", async () => {
    const fetch = mockFetch(200, { choices: [{ message: { content: "respuesta" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    const r = await completeLive(slot("openai"), req, { keySources: { env: { OPENAI_API_KEY: "sk-secret-xyz" } as any }, signal: okSignal }, { fetch });
    expect(r.text).toBe("respuesta");
    expect(r.usage.inputTokens).toBe(10);
    expect(r.usage.outputTokens).toBe(5);
    expect(r.usage.costUsd).toBeGreaterThan(0);
    // la clave viaja SOLO en el header authorization, jamás en el resultado
    expect(JSON.stringify(r)).not.toMatch(/sk-secret-xyz/);
    const call = fetch.mock.calls[0];
    expect(call[1].headers.authorization).toBe("Bearer sk-secret-xyz");
    expect(call[0]).toContain("api.openai.com");
  });
  it("Anthropic: header x-api-key, parsea content[].text", async () => {
    const fetch = mockFetch(200, { content: [{ type: "text", text: "hola" }], usage: { input_tokens: 3, output_tokens: 2 }, stop_reason: "end_turn" });
    const r = await completeLive(slot("anthropic"), req, { keySources: { env: { ANTHROPIC_API_KEY: "k1" } as any }, signal: okSignal }, { fetch });
    expect(r.text).toBe("hola");
    expect(fetch.mock.calls[0][1].headers["x-api-key"]).toBe("k1");
  });
  it("Gemini: header x-goog-api-key, parsea candidates.parts", async () => {
    const fetch = mockFetch(200, { candidates: [{ content: { parts: [{ text: "g" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 1 } });
    const r = await completeLive(slot("gemini"), req, { keySources: { env: { GEMINI_API_KEY: "g1" } as any }, signal: okSignal }, { fetch });
    expect(r.text).toBe("g");
    expect(fetch.mock.calls[0][1].headers["x-goog-api-key"]).toBe("g1");
  });

  it("sin clave → MissingProviderKey (unhealthy, no finge éxito)", async () => {
    const fetch = mockFetch(200, {});
    await expect(completeLive(slot("openai"), req, { keySources: { env: {} as any }, signal: okSignal }, { fetch })).rejects.toBeInstanceOf(MissingProviderKey);
    expect(fetch).not.toHaveBeenCalled(); // ni siquiera llama a red
  });
  it("429 con Retry-After → ProviderHttpError retryable + retryAfterMs", async () => {
    const fetch = mockFetch(429, {}, { "retry-after": "3" });
    const err = await completeLive(slot("openai"), req, { keySources: { env: { OPENAI_API_KEY: "k" } as any }, signal: okSignal }, { fetch, now: () => 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderHttpError);
    expect(err.status).toBe(429);
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(3000);
  });
  it("401 → ProviderHttpError NO retryable", async () => {
    const fetch = mockFetch(401, {});
    const err = await completeLive(slot("openai"), req, { keySources: { env: { OPENAI_API_KEY: "k" } as any }, signal: okSignal }, { fetch }).catch((e) => e);
    expect(err.status).toBe(401);
    expect(err.retryable).toBe(false);
  });
  it("respuesta 200 con shape inválido → InvalidProviderResponse (no finge texto)", async () => {
    const fetch = mockFetch(200, { choices: [{ message: { content: "" } }] }); // vacío
    await expect(completeLive(slot("openai"), req, { keySources: { env: { OPENAI_API_KEY: "k" } as any }, signal: okSignal }, { fetch })).rejects.toBeInstanceOf(InvalidProviderResponse);
  });
  it("abort/red caída → ProviderHttpError retryable (status 0)", async () => {
    const fetch = vi.fn(async () => { throw new Error("aborted"); }) as any;
    const err = await completeLive(slot("openai"), req, { keySources: { env: { OPENAI_API_KEY: "k" } as any }, signal: okSignal }, { fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderHttpError);
    expect(err.retryable).toBe(true);
  });
});

describe("adapters.complete — gate LIVE vs SHADOW", () => {
  it("sin opts.live → SHADOW (executed:false), no toca fetch", async () => {
    const a = buildAdapter(slot("openai"));
    const r = await a.complete(req);
    expect(r.executed).toBe(false);
    expect(r.mode).toBe("shadow");
  });
  it("live sin signal → lanza (deadline obligatorio)", async () => {
    const a = buildAdapter(slot("openai"));
    await expect(a.complete(req, { live: true, keySources: { env: { OPENAI_API_KEY: "k" } as any } })).rejects.toThrow(/AbortSignal/);
  });
  it("live sin clave → error unhealthy (degrada, no finge)", async () => {
    const a = buildAdapter(slot("openai"));
    await expect(a.complete(req, { live: true, signal: okSignal, keySources: { env: {} as any } })).rejects.toMatchObject({ unhealthy: true, provider: "openai" });
  });
  it("live con PII → se redacta ANTES de enviar al proveedor", async () => {
    const fetch = mockFetch(200, { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    // inyectamos fetch vía global temporalmente
    const orig = globalThis.fetch;
    (globalThis as any).fetch = fetch;
    try {
      const a = buildAdapter(slot("openai"));
      const r = await a.complete({ messages: [{ role: "user", content: "escribe a leak@evil.com" }] }, { live: true, signal: okSignal, keySources: { env: { OPENAI_API_KEY: "k" } as any } });
      expect(r.executed).toBe(true);
      const sent = JSON.stringify(fetch.mock.calls[0][1].body);
      expect(sent).not.toMatch(/leak@evil\.com/); // PII redactada antes de la red
      expect(sent).toContain("«EMAIL»");
      expect(r.piiRedactions).toBe(1);
    } finally {
      (globalThis as any).fetch = orig;
    }
  });
});
