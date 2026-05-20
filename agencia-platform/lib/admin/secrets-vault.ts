/**
 * Almacén de secretos del workspace. Centraliza TODAS las
 * credenciales/tokens que la plataforma guarda (cifradas en
 * Workspace.settings y en AsanaConnection) para que el admin pueda:
 *   - Verlas listadas y enmascaradas
 *   - Revelar el valor en claro (previa re-autenticación por contraseña)
 *   - Copiarlas para usarlas en otro sitio
 *
 * Por seguridad:
 *   - Solo lista MÁSCARAS por defecto (•••1234)
 *   - El valor en claro solo se devuelve por revealSecret(), que el
 *     endpoint protege con re-login + audit log.
 */

import { prisma } from "@/lib/db/prisma";
import { decryptSecret, maskSecret } from "@/lib/ai/crypto";

export type SecretSlot = {
  id: string;
  label: string;
  category: string;
  present: boolean;
  masked: string;
};

/**
 * Recolecta TODOS los valores en claro de un workspace. Uso interno
 * (no exponer crudo al cliente). Devuelve un mapa id → { label,
 * category, value }.
 */
async function collectSecrets(
  workspaceId: string
): Promise<Record<string, { label: string; category: string; value: string }>> {
  const out: Record<string, { label: string; category: string; value: string }> = {};
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { settings: true }
  });
  const s = (ws?.settings as any) ?? {};

  const add = (id: string, label: string, category: string, value: unknown) => {
    if (typeof value === "string" && value.trim()) {
      out[id] = { label, category, value: value.trim() };
    }
  };
  const addEnc = (id: string, label: string, category: string, enc: unknown) => {
    if (typeof enc === "string" && enc) {
      const v = decryptSecret(enc);
      if (v) out[id] = { label, category, value: v };
    }
  };

  // IA
  addEnc("anthropic", "Anthropic API key", "IA", s.ai?.anthropicApiKey);
  addEnc("openai", "OpenAI API key", "IA", s.ai?.openaiApiKey);
  addEnc("elevenlabs", "ElevenLabs API key", "IA", s.ai?.elevenlabsApiKey);

  // Integraciones
  addEnc("make", "Make.com API token", "Integraciones", s.integrations?.make?.apiTokenEnc);
  addEnc("fal", "fal.ai API key", "Integraciones", s.integrations?.fal?.apiKeyEnc);
  addEnc("holded", "Holded API key", "Integraciones", s.integrations?.holded?.apiKeyEnc);
  addEnc("github_pat", "GitHub PAT (self-heal)", "Integraciones", s.integrations?.selfHeal?.patEnc);
  add("telegram", "Telegram bot token", "Integraciones", s.integrations?.telegram?.botToken);

  // Leads / WhatsApp
  addEnc("waha_key", "WAHA API key", "WhatsApp", s.leads?.wahaApiKey);
  add("waha_url", "WAHA URL", "WhatsApp", s.leads?.wahaUrl);

  // Credenciales ad-hoc (META_ADS_TOKEN, etc.) — guardadas como
  // { enc } por clave en settings.adhocCredentials.
  const adhoc = s.adhocCredentials as Record<string, { enc: string }> | undefined;
  if (adhoc && typeof adhoc === "object") {
    for (const [key, entry] of Object.entries(adhoc)) {
      if (entry?.enc) {
        const v = decryptSecret(entry.enc);
        if (v) out[`adhoc:${key}`] = { label: key, category: "Meta / ad-hoc", value: v };
      }
    }
  }

  // Tokens de Asana (por usuario)
  const conns = await prisma.asanaConnection
    .findMany({
      where: { userId: { not: undefined } },
      select: { id: true, accessTokenEnc: true, accessToken: true, asanaUserId: true, userId: true }
    })
    .catch(() => []);
  // Filtramos a usuarios del workspace
  if (conns.length > 0) {
    const memberIds = new Set(
      (
        await prisma.membership.findMany({
          where: { workspaceId },
          select: { userId: true }
        })
      ).map((m) => m.userId)
    );
    for (const c of conns) {
      if (!memberIds.has(c.userId)) continue;
      const v = c.accessTokenEnc ? decryptSecret(c.accessTokenEnc) : c.accessToken || null;
      if (v) {
        out[`asana:${c.id}`] = {
          label: `Asana token (user ${c.asanaUserId ?? c.userId.slice(-6)})`,
          category: "Asana",
          value: v
        };
      }
    }
  }

  // Tokens de Meta Ads (por usuario, desde MetaConnection). El token que
  // no caduca guardado en /campanas-meta aparece aquí también.
  const metaConns = await prisma.metaConnection
    .findMany({
      where: { workspaceId },
      select: { id: true, accessTokenEnc: true, metaUserId: true, userId: true }
    })
    .catch(() => []);
  for (const c of metaConns) {
    const v = c.accessTokenEnc ? decryptSecret(c.accessTokenEnc) : null;
    if (v) {
      out[`meta:${c.id}`] = {
        label: `Meta Ads token (${c.metaUserId ?? c.userId.slice(-6)})`,
        category: "Meta Ads",
        value: v
      };
    }
  }

  return out;
}

export async function listSecrets(workspaceId: string): Promise<SecretSlot[]> {
  const all = await collectSecrets(workspaceId);
  return Object.entries(all).map(([id, { label, category, value }]) => ({
    id,
    label,
    category,
    present: true,
    masked: maskSecret(value)
  }));
}

export async function revealSecret(workspaceId: string, id: string): Promise<string | null> {
  const all = await collectSecrets(workspaceId);
  return all[id]?.value ?? null;
}
