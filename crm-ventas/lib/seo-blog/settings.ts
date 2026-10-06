/**
 * Ajustes del Publicador SEO → workspace.settings.seoBlog.
 *
 * En el CRM el negocio no ve ni configura claves ni modelos: Anthropic,
 * Freepik y Serper son las suyas si el operador se las ha puesto en /admin o,
 * si no, las de Negocio Vivo del entorno; los modelos
 * son los del módulo de contenidos (CONTENT_AI_MODEL / CONTENT_AI_FAST_MODEL).
 * El negocio solo ajusta preferencias propias (email de aviso, nota mínima SEO
 * e ideas por tanda).
 */
import { DEFAULT_MODEL, FAST_MODEL } from "@/lib/ai/anthropic";
import { patchWorkspaceSettings, readWorkspaceSettings } from "@/lib/content/settings";
import { resolveApiKey } from "@/lib/api-keys";

export type SeoBlogSettings = {
  serperApiKey: string | null;
  serperGl: string;
  serperHl: string;
  modelWriter: string;
  modelFast: string;
  freepikBase: string;
  freepikHeader: string;
  freepikEditPath: string;
  freepikT2iPath: string;
  imageEngine: string; // "nano-banana-2" (Gemini 3.1 Flash, texto legible) | "seedream-4.5"
  imageResolution: string; // nano banana: 1K | 2K | 4K
  seoMinScore: number;
  maxFixPasses: number;
  ideasPerRun: number;
  notifyEmail: string;
};

export const SEO_BLOG_DEFAULTS: Omit<SeoBlogSettings, "serperApiKey"> = {
  serperGl: "es",
  serperHl: "es",
  modelWriter: DEFAULT_MODEL, // redacción + humanización (máxima calidad)
  modelFast: FAST_MODEL, // propuestas, briefs, análisis de estilo
  freepikBase: "https://api.freepik.com",
  freepikHeader: "x-freepik-api-key",
  freepikEditPath: "/v1/ai/text-to-image/seedream-v4-5-edit",
  freepikT2iPath: "/v1/ai/text-to-image/seedream-v4-5",
  imageEngine: "nano-banana-2",
  imageResolution: "1K",
  seoMinScore: 85,
  maxFixPasses: 2,
  ideasPerRun: 12,
  notifyEmail: ""
};

/** Preferencias que el negocio puede cambiar (con sus límites). */
const USER_KEYS = {
  seoMinScore: { min: 50, max: 100 },
  ideasPerRun: { min: 3, max: 30 },
  notifyEmail: null
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clampInt(v: unknown, min: number, max: number, def: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
}

export function seoBlogSettingsFrom(settings: Record<string, any>): SeoBlogSettings {
  const raw: any = settings?.seoBlog ?? {};
  const out: SeoBlogSettings = { ...SEO_BLOG_DEFAULTS, serperApiKey: resolveApiKey(settings, "serper").key };
  out.seoMinScore = clampInt(raw.seoMinScore, USER_KEYS.seoMinScore.min, USER_KEYS.seoMinScore.max, SEO_BLOG_DEFAULTS.seoMinScore);
  out.ideasPerRun = clampInt(raw.ideasPerRun, USER_KEYS.ideasPerRun.min, USER_KEYS.ideasPerRun.max, SEO_BLOG_DEFAULTS.ideasPerRun);
  out.notifyEmail = typeof raw.notifyEmail === "string" && EMAIL_RE.test(raw.notifyEmail) ? raw.notifyEmail : "";
  return out;
}

export async function getSeoBlogSettings(workspaceId: string): Promise<SeoBlogSettings> {
  return seoBlogSettingsFrom(await readWorkspaceSettings(workspaceId));
}

/** Lo que ve la UI del negocio: sus preferencias y qué servicios están disponibles (sin claves ni modelos). */
export async function publicSeoBlogSettings(workspaceId: string) {
  const raw = await readWorkspaceSettings(workspaceId);
  const s = seoBlogSettingsFrom(raw);
  return {
    seoMinScore: s.seoMinScore,
    ideasPerRun: s.ideasPerRun,
    notifyEmail: s.notifyEmail,
    services: {
      writing: !!resolveApiKey(raw, "anthropic").key,
      images: !!resolveApiKey(raw, "freepik").key,
      google: !!s.serperApiKey
    }
  };
}

export class SettingsValidationError extends Error {}

export async function saveSeoBlogSettings(workspaceId: string, input: Record<string, unknown>) {
  const patch: Record<string, any> = {};
  if ("seoMinScore" in input && input.seoMinScore !== "" && input.seoMinScore !== null) {
    patch.seoMinScore = clampInt(input.seoMinScore, USER_KEYS.seoMinScore.min, USER_KEYS.seoMinScore.max, SEO_BLOG_DEFAULTS.seoMinScore);
  }
  if ("ideasPerRun" in input && input.ideasPerRun !== "" && input.ideasPerRun !== null) {
    patch.ideasPerRun = clampInt(input.ideasPerRun, USER_KEYS.ideasPerRun.min, USER_KEYS.ideasPerRun.max, SEO_BLOG_DEFAULTS.ideasPerRun);
  }
  if ("notifyEmail" in input) {
    const email = String(input.notifyEmail ?? "").trim().slice(0, 200);
    if (email && !EMAIL_RE.test(email)) throw new SettingsValidationError("El email de aviso no es válido");
    patch.notifyEmail = email;
  }
  await patchWorkspaceSettings(workspaceId, (settings) => {
    const cur: Record<string, any> = { ...(settings.seoBlog ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === "" || v === null) delete cur[k];
      else cur[k] = v;
    }
    settings.seoBlog = cur;
  });
  return publicSeoBlogSettings(workspaceId);
}
