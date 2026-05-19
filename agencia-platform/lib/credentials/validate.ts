/**
 * Validación de credenciales de un workspace.
 *
 * Una sola fuente de verdad llamada desde:
 *  - Tool de Sonia `validate_credentials` (pre-flight)
 *  - Cron `/api/cron/credential-watch` (proactivo cada 6h)
 *  - Admin UI (botón "Probar conexión")
 *
 * Cada integración se valida con la llamada MÁS BARATA posible
 * (idealmente "/me" o equivalent) — la idea es saber rápido si el
 * token aún vale, no listar datos.
 */

import { prisma } from "@/lib/db/prisma";

export type IntegrationName =
  | "meta_ads"
  | "make"
  | "openai"
  | "anthropic"
  | "elevenlabs"
  | "holded"
  | "google_calendar";

export type CredentialCheck =
  | { integration: IntegrationName; ok: true; detail?: string }
  | { integration: IntegrationName; ok: false; reason: string };

export type ValidationResult = {
  workspaceId: string;
  checked: IntegrationName[];
  valid: CredentialCheck[];
  invalid: CredentialCheck[];
};

const ALL_CHECKS: Record<
  IntegrationName,
  (workspaceId: string) => Promise<{ ok: true; detail?: string } | { ok: false; reason: string }>
> = {
  meta_ads: async (workspaceId) => {
    try {
      const { metaAdsListAdAccounts } = await import("@/lib/integrations/meta-ads");
      const accs = await metaAdsListAdAccounts(workspaceId);
      return { ok: true, detail: `${accs.length} ad accounts` };
    } catch (e: any) {
      return { ok: false, reason: String(e?.message ?? e).slice(0, 200) };
    }
  },
  make: async (workspaceId) => {
    try {
      const { makeListOrganizations } = await import("@/lib/integrations/make");
      const orgs = await makeListOrganizations(workspaceId);
      return { ok: true, detail: `${orgs.length} orgs` };
    } catch (e: any) {
      return { ok: false, reason: String(e?.message ?? e).slice(0, 200) };
    }
  },
  openai: async (workspaceId) => {
    try {
      const { getOpenAiKeyForWorkspace } = await import("@/lib/ai/openai");
      const k = await getOpenAiKeyForWorkspace(workspaceId);
      const r = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${k}` }
      });
      if (!r.ok) return { ok: false, reason: `OpenAI ${r.status}` };
      return { ok: true };
    } catch (e: any) {
      return { ok: false, reason: String(e?.message ?? e).slice(0, 200) };
    }
  },
  anthropic: async (workspaceId) => {
    try {
      const { getAnthropicForWorkspace } = await import("@/lib/ai/anthropic");
      await getAnthropicForWorkspace(workspaceId);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, reason: String(e?.message ?? e).slice(0, 200) };
    }
  },
  elevenlabs: async (workspaceId) => {
    try {
      const { elevenlabsTest } = await import("@/lib/integrations/elevenlabs");
      const r = await elevenlabsTest(workspaceId);
      return { ok: true, detail: `${r.voiceCount} voces` };
    } catch (e: any) {
      return { ok: false, reason: String(e?.message ?? e).slice(0, 200) };
    }
  },
  holded: async (workspaceId) => {
    try {
      const { holdedListInvoices } = await import("@/lib/integrations/holded");
      await holdedListInvoices({ workspaceId, limit: 1 });
      return { ok: true };
    } catch (e: any) {
      return { ok: false, reason: String(e?.message ?? e).slice(0, 200) };
    }
  },
  google_calendar: async (workspaceId) => {
    try {
      // Solo verificamos que haya al menos una conexión activa.
      const conn = await prisma.googleCalendarConnection.findFirst({
        where: { workspaceId } as any,
        select: { id: true, expiresAt: true } as any
      });
      if (!conn) return { ok: false, reason: "Sin conexión Google Calendar" };
      return { ok: true };
    } catch (e: any) {
      return { ok: false, reason: String(e?.message ?? e).slice(0, 200) };
    }
  }
};

/**
 * Valida solo las integraciones que el workspace tiene configuradas.
 * Si pasas `integrations`, valida solo esas. Si no, autodetecta.
 */
export async function validateWorkspaceCredentials(opts: {
  workspaceId: string;
  integrations?: IntegrationName[];
}): Promise<ValidationResult> {
  let toCheck: IntegrationName[];
  if (opts.integrations && opts.integrations.length > 0) {
    toCheck = opts.integrations;
  } else {
    // Autodetectar las que tienen credenciales en settings
    const ws = await prisma.workspace.findUnique({
      where: { id: opts.workspaceId },
      select: { settings: true }
    });
    const s = (ws?.settings as any) ?? {};
    toCheck = [];
    if (s.adhocCredentials?.META_ADS_TOKEN || s.integrations?.meta?.token) toCheck.push("meta_ads");
    if (s.integrations?.make?.apiTokenEnc) toCheck.push("make");
    if (s.ai?.openaiApiKey) toCheck.push("openai");
    if (s.ai?.anthropicApiKey) toCheck.push("anthropic");
    if (s.ai?.elevenlabsApiKey) toCheck.push("elevenlabs");
    if (s.integrations?.holded?.apiKeyEnc) toCheck.push("holded");
  }

  // Llamadas en paralelo
  const results = await Promise.all(
    toCheck.map(async (name): Promise<CredentialCheck> => {
      const r = await ALL_CHECKS[name](opts.workspaceId);
      if (r.ok) return { integration: name, ok: true, detail: r.detail };
      return { integration: name, ok: false, reason: r.reason };
    })
  );

  const valid = results.filter((r): r is Extract<CredentialCheck, { ok: true }> => r.ok);
  const invalid = results.filter((r): r is Extract<CredentialCheck, { ok: false }> => !r.ok);

  return {
    workspaceId: opts.workspaceId,
    checked: toCheck,
    valid,
    invalid
  };
}
