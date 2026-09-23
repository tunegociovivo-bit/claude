/**
 * Ajustes del Publicador SEO → workspace.settings.seoBlog.
 * Las claves de Anthropic y Freepik se REUTILIZAN de /admin/ai y del
 * calendario editorial (settings.ai.anthropicApiKey / settings.editorial.freepikApiKey).
 * Aquí solo vive lo propio del módulo (Serper, modelos, umbrales).
 */
import { prisma } from "@/lib/db/prisma";
import { encryptSecret, decryptSecret } from "@/lib/ai/crypto";
import { DEFAULT_MODEL } from "@/lib/ai/anthropic";

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
  seoMinScore: number;
  maxFixPasses: number;
  ideasPerRun: number;
  notifyEmail: string;
};

export const SEO_BLOG_DEFAULTS: Omit<SeoBlogSettings, "serperApiKey"> = {
  serperGl: "es",
  serperHl: "es",
  modelWriter: DEFAULT_MODEL, // redacción + humanización (máxima calidad)
  modelFast: "claude-sonnet-4-6", // propuestas, briefs, análisis de estilo
  freepikBase: "https://api.freepik.com",
  freepikHeader: "x-freepik-api-key",
  freepikEditPath: "/v1/ai/text-to-image/seedream-v4-5-edit",
  freepikT2iPath: "/v1/ai/text-to-image/seedream-v4-5",
  seoMinScore: 85,
  maxFixPasses: 2,
  ideasPerRun: 12,
  notifyEmail: ""
};

export async function getSeoBlogSettings(workspaceId: string): Promise<SeoBlogSettings> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const raw: any = (ws?.settings as any)?.seoBlog ?? {};
  const out: any = { ...SEO_BLOG_DEFAULTS };
  for (const k of Object.keys(SEO_BLOG_DEFAULTS)) {
    const v = raw[k];
    if (v === undefined || v === null || v === "") continue;
    out[k] = typeof (SEO_BLOG_DEFAULTS as any)[k] === "number" ? Number(v) : String(v);
  }
  out.serperApiKey = raw.serperApiKey ? decryptSecret(raw.serperApiKey) : process.env.SERPER_API_KEY ?? null;
  return out as SeoBlogSettings;
}

export async function publicSeoBlogSettings(workspaceId: string) {
  const s = await getSeoBlogSettings(workspaceId);
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const settings: any = ws?.settings ?? {};
  const { serperApiKey, ...rest } = s;
  return {
    ...rest,
    serperConfigured: !!serperApiKey,
    anthropicConfigured: !!settings?.ai?.anthropicApiKey || !!process.env.ANTHROPIC_API_KEY,
    freepikConfigured: !!settings?.editorial?.freepikApiKey || !!process.env.FREEPIK_API_KEY
  };
}

export async function saveSeoBlogSettings(workspaceId: string, input: Record<string, unknown>) {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const settings: any = (ws?.settings as any) ?? {};
  const cur: any = settings.seoBlog ?? {};
  for (const [k, def] of Object.entries(SEO_BLOG_DEFAULTS)) {
    if (!(k in input)) continue;
    const v = input[k];
    if (v === null || v === "") delete cur[k];
    else cur[k] = typeof def === "number" ? Number(v) : String(v).trim();
  }
  if ("serperApiKey" in input) {
    const v = input.serperApiKey;
    if (v === null || v === "") delete cur.serperApiKey;
    else if (typeof v === "string" && !v.startsWith("••")) cur.serperApiKey = encryptSecret(v.trim());
  }
  settings.seoBlog = cur;
  await prisma.workspace.update({ where: { id: workspaceId }, data: { settings } });
  return publicSeoBlogSettings(workspaceId);
}
