/**
 * Configuración global de NV Leads Pro:
 * - Google Places API key (cifrada)
 * - WAHA URL + API key + session
 * - Ventana de envío + delays + daily limit + variations
 * - Webhook token (auto generado)
 *
 * Almacenado en workspace.settings.leads. Solo admins.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { encryptSecret } from "@/lib/ai/crypto";

async function requireAdmin(workspaceId: string, userId: string | undefined) {
  if (!userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const me = await prisma.membership.findFirst({ where: { workspaceId, userId } });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins");
}

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const s: any = (ws?.settings as any)?.leads ?? {};
  // Asegurar webhook token
  if (!s.webhookToken) {
    s.webhookToken = randomBytes(24).toString("hex");
    const settings = { ...(ws?.settings as any), leads: s };
    await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } });
  }
  // Fallback a la config del plugin migrada (settings.integrations.evolution),
  // para que la UI muestre WhatsApp como configurado sin reintroducir nada.
  const evo: any = (ws?.settings as any)?.integrations?.evolution ?? {};
  return NextResponse.json({
    googleConfigured: !!(s.googleApiKey || (ws?.settings as any)?.integrations?.googlePlaces?.apiKeyEnc),
    whatsappProvider: s.whatsappProvider === "evolution" ? "evolution" : "waha",
    wahaUrl: s.wahaUrl ?? evo.url ?? process.env.WAHA_URL ?? null,
    wahaConfigured: !!(s.wahaApiKey || evo.apiKeyEnc || process.env.WAHA_API_KEY),
    wahaSession: s.wahaSession ?? process.env.WAHA_SESSION ?? "default",
    evolutionUrl: s.evolutionUrl ?? evo.url ?? process.env.EVOLUTION_API_URL ?? null,
    evolutionConfigured: !!(s.evolutionApiKey || evo.apiKeyEnc || process.env.EVOLUTION_API_KEY),
    evolutionInstance: s.evolutionInstance ?? evo.instance ?? "default",
    whatsappCountryCode: s.whatsappCountryCode ?? "34",
    notifyInterestedPhone: s.notifyInterestedPhone ?? "",
    webhookLastHit: s.webhookLastHit ?? null,
    webhookLastEvent: s.webhookLastEvent ?? null,
    maxPerHour: s.maxPerHour ?? 10,
    minCoolDownDaysPerRecipient: s.minCoolDownDaysPerRecipient ?? 7,
    maxNewChatsPerDay: s.maxNewChatsPerDay ?? 25,
    recoveryMode: !!s.recoveryMode,
    recoverySince: s.recoverySince ?? null,
    recoveryDurationDays: s.recoveryDurationDays ?? 14,
    warmupEnabled: s.warmupEnabled ?? true,
    warmupDays: s.warmupDays ?? 21,
    warmupStartCap: s.warmupStartCap ?? 10,
    autoRecoveryEnabled: s.autoRecoveryEnabled ?? true,
    dailyJitterPct: s.dailyJitterPct ?? 0.15,
    sendEnabled: s.sendEnabled ?? true,
    sendPaused: s.sendPaused ?? false,
    sendWindowStart: s.sendWindowStart ?? "09:00",
    sendWindowEnd: s.sendWindowEnd ?? "20:00",
    sendDelayMinSec: s.sendDelayMinSec ?? 60,
    sendDelayMaxSec: s.sendDelayMaxSec ?? 180,
    sendOnWeekends: s.sendOnWeekends ?? false,
    dailyLimit: s.dailyLimit ?? 80,
    enableVariations: s.enableVariations ?? true,
    validateWaBeforeSend: s.validateWaBeforeSend ?? true,
    maxAttempts: s.maxAttempts ?? 3,
    webhookToken: s.webhookToken
  });
});

const schema = z.object({
  // Para las API keys: NO se borran al recibir "" — eso pasaba antes y la
  // gente perdía la key al pulsar Guardar sin tocar el campo. Solo se borra
  // con el flag explícito clearXxxKey:true. Si llega un string no vacío,
  // se cifra y guarda.
  googleApiKey: z.string().nullable().optional(),
  clearGoogleApiKey: z.boolean().optional(),
  whatsappProvider: z.enum(["waha", "evolution"]).optional(),
  wahaUrl: z.string().url().or(z.literal("")).nullable().optional(),
  wahaApiKey: z.string().nullable().optional(),
  clearWahaApiKey: z.boolean().optional(),
  wahaSession: z.string().optional(),
  evolutionUrl: z.string().url().or(z.literal("")).nullable().optional(),
  evolutionApiKey: z.string().nullable().optional(),
  clearEvolutionApiKey: z.boolean().optional(),
  evolutionInstance: z.string().optional(),
  whatsappCountryCode: z.string().regex(/^\d{1,3}$/).optional(),
  notifyInterestedPhone: z.string().max(40).optional(),
  sendEnabled: z.boolean().optional(),
  sendPaused: z.boolean().optional(),
  sendWindowStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  sendWindowEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  sendDelayMinSec: z.number().int().min(0).max(3600).optional(),
  sendDelayMaxSec: z.number().int().min(0).max(3600).optional(),
  sendOnWeekends: z.boolean().optional(),
  dailyLimit: z.number().int().min(1).max(10000).optional(),
  enableVariations: z.boolean().optional(),
  validateWaBeforeSend: z.boolean().optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
  maxPerHour: z.number().int().min(1).max(100).optional(),
  minCoolDownDaysPerRecipient: z.number().int().min(0).max(60).optional(),
  maxNewChatsPerDay: z.number().int().min(1).max(500).optional(),
  recoveryMode: z.boolean().optional(),
  recoveryDurationDays: z.number().int().min(1).max(60).optional(),
  warmupEnabled: z.boolean().optional(),
  warmupDays: z.number().int().min(1).max(120).optional(),
  warmupStartCap: z.number().int().min(1).max(1000).optional(),
  autoRecoveryEnabled: z.boolean().optional(),
  dailyJitterPct: z.number().min(0).max(0.5).optional(),
  rotateWebhookToken: z.boolean().optional()
});

export const PATCH = withApi({ scope: "*" }, async (req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings: any = ws?.settings ?? {};
  settings.leads = settings.leads ?? {};
  const s = settings.leads;

  // Borrar requiere flag explícito clearXxxKey:true. Si solo llega "" o null
  // lo IGNORAMOS — antes esto borraba la key al pulsar Guardar sin tocar el
  // campo (placeholder ••••••••).
  if (parsed.data.clearGoogleApiKey) {
    delete s.googleApiKey;
  } else if (typeof parsed.data.googleApiKey === "string" && parsed.data.googleApiKey.trim()) {
    s.googleApiKey = encryptSecret(parsed.data.googleApiKey.trim());
  }
  if (parsed.data.wahaUrl !== undefined) {
    s.wahaUrl = parsed.data.wahaUrl || null;
  }
  if (parsed.data.clearWahaApiKey) {
    delete s.wahaApiKey;
  } else if (typeof parsed.data.wahaApiKey === "string" && parsed.data.wahaApiKey.trim()) {
    s.wahaApiKey = encryptSecret(parsed.data.wahaApiKey.trim());
  }
  if (parsed.data.evolutionUrl !== undefined) {
    s.evolutionUrl = parsed.data.evolutionUrl || null;
  }
  if (parsed.data.clearEvolutionApiKey) {
    delete s.evolutionApiKey;
  } else if (typeof parsed.data.evolutionApiKey === "string" && parsed.data.evolutionApiKey.trim()) {
    s.evolutionApiKey = encryptSecret(parsed.data.evolutionApiKey.trim());
  }
  for (const k of [
    "whatsappProvider",
    "wahaSession",
    "evolutionInstance",
    "whatsappCountryCode",
    "notifyInterestedPhone",
    "sendEnabled",
    "sendPaused",
    "sendWindowStart",
    "sendWindowEnd",
    "sendDelayMinSec",
    "sendDelayMaxSec",
    "sendOnWeekends",
    "dailyLimit",
    "enableVariations",
    "validateWaBeforeSend",
    "maxAttempts",
    "maxPerHour",
    "minCoolDownDaysPerRecipient",
    "maxNewChatsPerDay",
    "recoveryDurationDays",
    "warmupEnabled",
    "warmupDays",
    "warmupStartCap",
    "autoRecoveryEnabled",
    "dailyJitterPct"
  ] as const) {
    if (parsed.data[k] !== undefined) s[k] = parsed.data[k];
  }
  // Recovery toggle: al activar, sella la fecha de inicio. Al desactivar
  // borra recoverySince para que el siguiente toggle vuelva a empezar.
  if (parsed.data.recoveryMode !== undefined) {
    if (parsed.data.recoveryMode) {
      if (!s.recoveryMode) s.recoverySince = new Date().toISOString();
      s.recoveryMode = true;
    } else {
      s.recoveryMode = false;
      s.recoverySince = null;
    }
  }
  if (parsed.data.rotateWebhookToken) {
    s.webhookToken = randomBytes(24).toString("hex");
  }
  await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } });
  return NextResponse.json({ ok: true, webhookToken: s.webhookToken });
});
