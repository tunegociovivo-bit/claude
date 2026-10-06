/**
 * Claves de API por cliente (Workspace.settings.apiKeys), gestionadas por el
 * operador desde /admin. Cada servicio usa, por este orden:
 *   1. la clave propia del cliente (cifrada con ENCRYPTION_KEY),
 *   2. la clave antigua que algunos módulos guardaban por su cuenta (Freepik del
 *      Editorial, ElevenLabs de integraciones),
 *   3. la clave de Negocio Vivo del entorno (Railway).
 * Las claves nunca salen del servidor: el panel solo ve si hay clave y su máscara.
 */
import { encryptSecret, decryptSecret } from "@/lib/ai/crypto";

export const API_PROVIDERS = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    env: "ANTHROPIC_API_KEY",
    usedFor: "Sonia (WhatsApp), textos del Editorial y artículos del Publicador SEO",
    placeholder: "sk-ant-…"
  },
  { id: "openai", label: "OpenAI", env: "OPENAI_API_KEY", usedFor: "Imágenes y guiones de vídeo del Editorial", placeholder: "sk-…" },
  { id: "freepik", label: "Freepik", env: "FREEPIK_API_KEY", usedFor: "Imágenes del blog y vídeos (Kling)", placeholder: "FPSX…" },
  { id: "serper", label: "Serper (Google)", env: "SERPER_API_KEY", usedFor: "Top 10 de Google, «La gente también pregunta» y competidores", placeholder: "Clave de serper.dev" },
  { id: "elevenlabs", label: "ElevenLabs", env: "ELEVENLABS_API_KEY", usedFor: "Locución de los vídeos", placeholder: "sk_…" }
] as const;

export type ApiProvider = (typeof API_PROVIDERS)[number]["id"];
export type ApiKeySource = "client" | "negociovivo" | "none";
export const API_PROVIDER_IDS = API_PROVIDERS.map((p) => p.id) as ApiProvider[];

const ENV: Record<ApiProvider, string> = Object.fromEntries(API_PROVIDERS.map((p) => [p.id, p.env])) as Record<ApiProvider, string>;

export function isApiProvider(value: unknown): value is ApiProvider {
  return typeof value === "string" && (API_PROVIDER_IDS as string[]).includes(value);
}

function obj(v: unknown): Record<string, any> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {};
}

function decrypt(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  return decryptSecret(value)?.trim() || null;
}

/** Clave propia del cliente (incluidas las que guardaban antes el Editorial y las integraciones). */
function ownKey(settings: unknown, provider: ApiProvider): string | null {
  const s = obj(settings);
  const own = decrypt(obj(s.apiKeys)[provider]);
  if (own) return own;
  if (provider === "freepik") return decrypt(obj(s.editorial).freepikApiKey);
  if (provider === "elevenlabs") return decrypt(obj(obj(s.integrations).elevenlabs).apiKey);
  return null;
}

/** Clave que usará el cliente para `provider` y de dónde sale. */
export function resolveApiKey(settings: unknown, provider: ApiProvider): { key: string | null; source: ApiKeySource } {
  const own = ownKey(settings, provider);
  if (own) return { key: own, source: "client" };
  const env = process.env[ENV[provider]]?.trim();
  if (env) return { key: env, source: "negociovivo" };
  return { key: null, source: "none" };
}

/** ID de voz de ElevenLabs propio del cliente (las voces personalizadas solo existen en su cuenta). */
export function clientVoiceId(settings: unknown): string | null {
  const v = obj(obj(settings).apiKeys).elevenlabsVoiceId;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export async function getApiKey(workspaceId: string, provider: ApiProvider): Promise<{ key: string | null; source: ApiKeySource }> {
  const { readWorkspaceSettings } = await import("@/lib/content/settings");
  return resolveApiKey(await readWorkspaceSettings(workspaceId), provider);
}

export function maskKey(key: string): string {
  if (key.length <= 10) return "••••";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export type ApiKeyStatus = { source: ApiKeySource; masked: string; negocioVivoAvailable: boolean };

/** Lo que ve el panel del operador: de dónde sale cada clave y su máscara (nunca la clave). */
export function apiKeysStatus(settings: unknown): { keys: Record<ApiProvider, ApiKeyStatus>; elevenlabsVoiceId: string } {
  const keys = {} as Record<ApiProvider, ApiKeyStatus>;
  for (const p of API_PROVIDER_IDS) {
    const r = resolveApiKey(settings, p);
    keys[p] = {
      source: r.source,
      masked: r.source === "client" && r.key ? maskKey(r.key) : "",
      negocioVivoAvailable: Boolean(process.env[ENV[p]]?.trim())
    };
  }
  return { keys, elevenlabsVoiceId: clientVoiceId(settings) ?? "" };
}

export class ApiKeyValidationError extends Error {}

/** Normaliza una clave pegada: sin espacios ni comillas alrededor; rechaza lo que no puede ser una clave. */
export function normalizeApiKeyInput(value: string): string {
  const v = value.trim().replace(/^["']|["']$/g, "").trim();
  if (v.length < 8 || v.length > 400 || /\s/.test(v)) throw new ApiKeyValidationError("La clave no tiene un formato válido (sin espacios, entre 8 y 400 caracteres).");
  return v;
}

/**
 * Aplica los cambios del panel sobre settings (en sitio). Valor:
 *   string → se guarda cifrada · null o "" → se quita (vuelve a la de Negocio Vivo).
 * Al quitar Freepik/ElevenLabs también se borran las claves antiguas de esos módulos,
 * para que «Quitar» deje de verdad la de Negocio Vivo.
 */
export function applyApiKeysPatch(settings: Record<string, any>, patch: Record<string, unknown>): ApiProvider[] {
  const changed: ApiProvider[] = [];
  const store = obj(settings.apiKeys);
  for (const p of API_PROVIDER_IDS) {
    if (!(p in patch)) continue;
    const value = patch[p];
    if (value === null || value === "") {
      delete store[p];
      if (p === "freepik" && settings.editorial && typeof settings.editorial === "object") delete settings.editorial.freepikApiKey;
      if (p === "elevenlabs" && settings.integrations?.elevenlabs && typeof settings.integrations.elevenlabs === "object") delete settings.integrations.elevenlabs.apiKey;
    } else if (typeof value === "string") {
      store[p] = encryptSecret(normalizeApiKeyInput(value));
    } else continue;
    changed.push(p);
  }
  if ("elevenlabsVoiceId" in patch) {
    const v = typeof patch.elevenlabsVoiceId === "string" ? patch.elevenlabsVoiceId.trim() : "";
    if (v && !/^[A-Za-z0-9_-]{6,64}$/.test(v)) throw new ApiKeyValidationError("El ID de voz de ElevenLabs no es válido.");
    if (v) store.elevenlabsVoiceId = v;
    else delete store.elevenlabsVoiceId;
  }
  store.updatedAt = new Date().toISOString();
  settings.apiKeys = store;
  return changed;
}

/** Comprobación ligera de una clave contra su servicio (sin generar contenido). */
export async function testApiKey(provider: ApiProvider, key: string): Promise<{ ok: boolean; message: string }> {
  const t = AbortSignal.timeout(15_000);
  const verdict = (status: number, okStatuses: number[] = [200]) =>
    okStatuses.includes(status)
      ? { ok: true, message: "Clave válida" }
      : status === 401 || status === 403
        ? { ok: false, message: "La clave no es válida o no tiene permisos" }
        : status === 429
          ? { ok: true, message: "Clave válida (límite de uso alcanzado ahora mismo)" }
          : { ok: false, message: `El servicio respondió ${status}` };
  try {
    switch (provider) {
      case "anthropic": {
        const r = await fetch("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" }, signal: t });
        return verdict(r.status);
      }
      case "openai": {
        const r = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` }, signal: t });
        return verdict(r.status);
      }
      case "freepik": {
        // Estado de una tarea inexistente: clave válida → 404; clave mala → 401/403. No gasta créditos.
        const r = await fetch("https://api.freepik.com/v1/ai/text-to-image/seedream-v4-5/00000000-0000-0000-0000-000000000000", {
          headers: { "x-freepik-api-key": key, Accept: "application/json" },
          signal: t
        });
        return verdict(r.status, [200, 404]);
      }
      case "serper": {
        const r = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: { "X-API-KEY": key, "Content-Type": "application/json" },
          body: JSON.stringify({ q: "negocio vivo", gl: "es", hl: "es", num: 1 }),
          signal: t
        });
        return verdict(r.status);
      }
      case "elevenlabs": {
        const r = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": key }, signal: t });
        return verdict(r.status);
      }
    }
  } catch (e: any) {
    return { ok: false, message: `No se pudo contactar con el servicio (${String(e?.message ?? e).slice(0, 80)})` };
  }
}
