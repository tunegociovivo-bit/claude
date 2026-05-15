/**
 * GET /api/v1/admin/credentials
 *
 * Devuelve TODAS las credenciales/secretos almacenados en
 * workspace.settings, descifrados en plano para que el admin las pueda
 * copiar a Railway / GitHub Secrets / WAHA / etc.
 *
 * Solo admins. Endpoint sensible — no se loguea el body.
 *
 * Cubre:
 *   - Anthropic API key  (settings.ai.anthropicApiKey)
 *   - OpenAI API key     (settings.ai.openaiApiKey)
 *   - Freepik API key    (settings.editorial.freepikApiKey)
 *   - Google Places key  (settings.leads.googleApiKey)
 *   - WAHA URL + API key + session (settings.leads.waha*)
 *   - Webhook tokens (leads, editorial Make, integrations evolution)
 *   - Storage R2 (informativo: lo lee de env, no de BD)
 *
 * También señala qué env vars de Railway están configuradas (booleano,
 * no muestra valores de env por seguridad).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { decryptSecret } from "@/lib/ai/crypto";

async function requireAdmin(workspaceId: string, userId: string | undefined) {
  if (!userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const me = await prisma.membership.findFirst({ where: { workspaceId, userId } });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins");
}

function safeDecrypt(v: any): string | null {
  if (!v || typeof v !== "string") return null;
  try {
    return decryptSecret(v);
  } catch {
    return null;
  }
}

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);

  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings: any = ws?.settings ?? {};

  const ai = settings.ai ?? {};
  const editorial = settings.editorial ?? {};
  const leads = settings.leads ?? {};
  const integrations = settings.integrations ?? {};

  const credentials = {
    // ============ IA ============
    anthropicApiKey: {
      key: "ANTHROPIC_API_KEY",
      label: "Anthropic (Claude)",
      value: safeDecrypt(ai.anthropicApiKey),
      configIn: "/admin/ai",
      docsUrl: "https://console.anthropic.com/settings/keys",
      sensitive: true
    },
    openaiApiKey: {
      key: "OPENAI_API_KEY",
      label: "OpenAI (GPT-Image-1, Whisper, GPT-4)",
      value: safeDecrypt(ai.openaiApiKey),
      configIn: "/admin/reviews",
      docsUrl: "https://platform.openai.com/api-keys",
      sensitive: true
    },
    freepikApiKey: {
      key: "FREEPIK_API_KEY",
      label: "Freepik (modelo imagen barato)",
      value: safeDecrypt(editorial.freepikApiKey),
      configIn: "/admin/editorial → ⚙️",
      docsUrl: "https://www.freepik.com/developers/dashboard",
      sensitive: true
    },
    // ============ Leads ============
    googleApiKey: {
      key: "GOOGLE_PLACES_API_KEY",
      label: "Google Places API",
      value: safeDecrypt(leads.googleApiKey),
      configIn: "/admin/leads → Ajustes",
      docsUrl: "https://console.cloud.google.com/google/maps-apis/credentials",
      sensitive: true
    },
    wahaUrl: {
      key: "WAHA_URL",
      label: "WAHA URL",
      value: leads.wahaUrl ?? null,
      configIn: "/admin/leads → Ajustes",
      sensitive: false
    },
    wahaApiKey: {
      key: "WAHA_API_KEY",
      label: "WAHA API key",
      value: safeDecrypt(leads.wahaApiKey),
      configIn: "/admin/leads → Ajustes",
      sensitive: true
    },
    wahaSession: {
      key: "WAHA_SESSION",
      label: "WAHA session name",
      value: leads.wahaSession ?? "default",
      configIn: "/admin/leads → Ajustes",
      sensitive: false
    },
    leadsWebhookToken: {
      key: "LEADS_WEBHOOK_TOKEN",
      label: "Token webhook entrante leads",
      value: leads.webhookToken ?? null,
      configIn: "/admin/leads → Ajustes",
      sensitive: true,
      hint: "Configurar en WAHA como URL: /api/v1/leads/webhook/<este token>"
    },
    // ============ Editorial / Webhook Make ============
    editorialMakeWebhookUrl: {
      key: "EDITORIAL_MAKE_WEBHOOK_URL",
      label: "Webhook Make al aprobar mes editorial",
      value: editorial.makeWebhookUrl ?? null,
      configIn: "/admin/editorial → ⚙️",
      sensitive: false
    },
    evolutionWebhookToken: {
      key: "EVOLUTION_WEBHOOK_TOKEN_LEGACY",
      label: "Webhook token legacy (Evolution / integraciones antiguas)",
      value: integrations.evolution?.webhookToken ?? null,
      configIn: "/admin/integrations",
      sensitive: true
    }
  };

  // Env vars que SÍ esperamos en Railway (informativo, no muestra valor)
  const env = {
    INTERNAL_CRON_TOKEN: !!process.env.INTERNAL_CRON_TOKEN,
    GITHUB_TOKEN_FOR_ERRORS: !!process.env.GITHUB_TOKEN_FOR_ERRORS,
    GITHUB_REPO_FOR_ERRORS: process.env.GITHUB_REPO_FOR_ERRORS ?? null,
    CLAUDE_CODE_SESSION_URL: process.env.CLAUDE_CODE_SESSION_URL ?? null,
    STORAGE_ENDPOINT: process.env.STORAGE_ENDPOINT ?? null,
    STORAGE_BUCKET: process.env.STORAGE_BUCKET ?? null,
    STORAGE_REGION: process.env.STORAGE_REGION ?? null,
    STORAGE_ACCESS_KEY_ID: !!process.env.STORAGE_ACCESS_KEY_ID,
    STORAGE_SECRET_ACCESS_KEY: !!process.env.STORAGE_SECRET_ACCESS_KEY,
    STORAGE_PUBLIC_URL: process.env.STORAGE_PUBLIC_URL ?? null,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? null,
    DATABASE_URL_SET: !!process.env.DATABASE_URL,
    ANTHROPIC_API_KEY_ENV: !!process.env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY_ENV: !!process.env.OPENAI_API_KEY,
    GOOGLE_PLACES_API_KEY_ENV: !!process.env.GOOGLE_PLACES_API_KEY,
    FREEPIK_API_KEY_ENV: !!process.env.FREEPIK_API_KEY,
    WAHA_URL_ENV: !!process.env.WAHA_URL,
    WAHA_API_KEY_ENV: !!process.env.WAHA_API_KEY
  };

  return NextResponse.json({ credentials, env });
});
