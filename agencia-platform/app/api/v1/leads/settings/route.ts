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
    // Colaboración con un ayuntamiento: si está, los mensajes pueden usar
    // {{colaboracion_ayto}} / {{ayuntamiento}} para nombrarlo (más confianza).
    ayuntamiento: s.ayuntamiento ?? "",
    autoReplyEnabled: !!s.autoReplyEnabled,
    autoReplyText: s.autoReplyText ?? "¡Hola! Gracias por escribir 🙌 Te atiendo enseguida.",
    autoFollowupEnabled: !!s.autoFollowupEnabled,
    // Crear tarea de seguimiento en el tablero al detectar un lead interesado.
    // Desactivado por defecto (no llena la columna de Seguimiento).
    followupTaskEnabled: s.followupTaskEnabled ?? false,
    // Fuentes premium de captación.
    metaAdsConfigured: !!(s.metaAdsTokenEnc || s.metaAdsToken || process.env.META_ADS_TOKEN),
    scrapflyConfigured: !!(s.scrapflyApiKeyEnc || process.env.SCRAPFLY_API_KEY),
    // Enriquecimiento de contacto de directivos.
    hunterConfigured: !!(s.hunterApiKeyEnc || process.env.HUNTER_API_KEY),
    apolloConfigured: !!(s.apolloApiKeyEnc || process.env.APOLLO_API_KEY),
    // Voz IA (ElevenLabs) para notas de voz.
    elevenLabsConfigured: !!(s.elevenLabsApiKeyEnc || process.env.ELEVENLABS_API_KEY),
    elevenLabsVoiceId: s.elevenLabsVoiceId ?? "",
    voiceSpeed: s.voiceSpeed ?? 1.0,
    voiceShorten: s.voiceShorten ?? true,
    voiceMaxSeconds: s.voiceMaxSeconds ?? 18,
    webhookLastHit: s.webhookLastHit ?? null,
    webhookLastEvent: s.webhookLastEvent ?? null,
    maxPerHour: s.maxPerHour ?? 10,
    minCoolDownDaysPerRecipient: s.minCoolDownDaysPerRecipient ?? 7,
    maxNewChatsPerDay: s.maxNewChatsPerDay ?? 10,
    recoveryMode: !!s.recoveryMode,
    recoverySince: s.recoverySince ?? null,
    recoveryDurationDays: s.recoveryDurationDays ?? 14,
    warmupEnabled: s.warmupEnabled ?? true,
    warmupDays: s.warmupDays ?? 45,
    warmupStartCap: s.warmupStartCap ?? 3,
    warmupChatEnabled: s.warmupChatEnabled ?? true,
    principalPhone: s.principalPhone ?? null,
    principalSince: s.principalSince ?? null,
    wahaProxy: s.wahaProxy ?? null,
    proxyStatus: s.proxyStatus ?? {},
    autoRecoveryEnabled: s.autoRecoveryEnabled ?? true,
    dailyJitterPct: s.dailyJitterPct ?? 0.15,
    blockLinksInFirstMessage: s.blockLinksInFirstMessage ?? true,
    replyRateGuardEnabled: !!s.replyRateGuardEnabled,
    // Módulo Empleos: si true (por defecto), los emails a empresas que contratan
    // se redactan y quedan pendientes de aprobación manual antes de enviarse.
    jobsReviewMode: s.jobsReviewMode ?? true,
    sendEnabled: s.sendEnabled ?? true,
    sendPaused: s.sendPaused ?? false,
    sendWindowStart: s.sendWindowStart ?? "09:00",
    sendWindowEnd: s.sendWindowEnd ?? "20:00",
    sendDelayMinSec: s.sendDelayMinSec ?? 60,
    sendDelayMaxSec: s.sendDelayMaxSec ?? 180,
    sendOnWeekends: s.sendOnWeekends ?? false,
    dailyLimit: s.dailyLimit ?? 60,
    enableVariations: s.enableVariations ?? true,
    validateWaBeforeSend: s.validateWaBeforeSend ?? true,
    maxAttempts: s.maxAttempts ?? 3,
    channels: Array.isArray(s.channels) ? s.channels : [],
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
  ayuntamiento: z.string().max(80).optional(),
  autoReplyEnabled: z.boolean().optional(),
  autoReplyText: z.string().max(1000).optional(),
  autoFollowupEnabled: z.boolean().optional(),
  followupTaskEnabled: z.boolean().optional(),
  // Fuentes premium: token de Meta Ad Library y API key de Scrapfly (cifrados).
  metaAdsToken: z.string().max(500).optional(),
  clearMetaAdsToken: z.boolean().optional(),
  scrapflyApiKey: z.string().max(200).optional(),
  clearScrapflyApiKey: z.boolean().optional(),
  hunterApiKey: z.string().max(200).optional(),
  clearHunterApiKey: z.boolean().optional(),
  apolloApiKey: z.string().max(200).optional(),
  clearApolloApiKey: z.boolean().optional(),
  // Voz IA (ElevenLabs): key cifrada + id de la voz (clonada o de su catálogo).
  elevenLabsApiKey: z.string().max(200).optional(),
  clearElevenLabsApiKey: z.boolean().optional(),
  elevenLabsVoiceId: z.string().max(80).optional(),
  voiceSpeed: z.number().min(0.7).max(1.2).optional(),
  voiceShorten: z.boolean().optional(),
  voiceMaxSeconds: z.number().int().min(8).max(60).optional(),
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
  warmupChatEnabled: z.boolean().optional(),
  principalPhone: z.string().max(30).nullable().optional(),
  // Proxy global por defecto para las sesiones de WhatsApp (anti-baneo: salir por
  // IP residencial/móvil, no por la del datacenter). Ej: http://user:pass@host:port
  wahaProxy: z.string().max(200).nullable().optional(),
  autoRecoveryEnabled: z.boolean().optional(),
  dailyJitterPct: z.number().min(0).max(0.5).optional(),
  blockLinksInFirstMessage: z.boolean().optional(),
  replyRateGuardEnabled: z.boolean().optional(),
  jobsReviewMode: z.boolean().optional(),
  rotateWebhookToken: z.boolean().optional(),
  // Multi-número de WhatsApp: lista de sesiones/instancias para repartir envíos.
  channels: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        label: z.string().max(60).optional(),
        dailyLimit: z.number().int().min(1).max(1000).optional(),
        active: z.boolean().optional(),
        // Calentamiento por teléfono: fecha de alta del número (se autosella) y
        // su número E.164 (para el calentamiento por conversación entre teléfonos).
        addedAt: z.string().nullable().optional(),
        phone: z.string().max(30).nullable().optional(),
        // Reinicio de la rampa de calentamiento (teléfono nuevo o recuperado).
        warmupSince: z.string().nullable().optional(),
        // Proxy residencial/móvil específico de ESTE número (prioridad sobre el
        // global). Cada número con su IP sticky = mucho menos baneo.
        proxy: z.string().max(200).nullable().optional()
      })
    )
    .max(20)
    .optional()
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
  // Número principal ANTES de aplicar cambios: si cambia, reiniciamos su rampa
  // de calentamiento más abajo (número nuevo tras un baneo → arranca suave).
  const prevPrincipalPhone = s.principalPhone ?? null;

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
  if (parsed.data.clearMetaAdsToken) {
    delete s.metaAdsTokenEnc;
    delete s.metaAdsToken; // limpia también el legacy en texto plano
  } else if (typeof parsed.data.metaAdsToken === "string" && parsed.data.metaAdsToken.trim()) {
    s.metaAdsTokenEnc = encryptSecret(parsed.data.metaAdsToken.trim());
    delete s.metaAdsToken;
  }
  if (parsed.data.clearScrapflyApiKey) {
    delete s.scrapflyApiKeyEnc;
  } else if (typeof parsed.data.scrapflyApiKey === "string" && parsed.data.scrapflyApiKey.trim()) {
    s.scrapflyApiKeyEnc = encryptSecret(parsed.data.scrapflyApiKey.trim());
  }
  if (parsed.data.clearHunterApiKey) {
    delete s.hunterApiKeyEnc;
  } else if (typeof parsed.data.hunterApiKey === "string" && parsed.data.hunterApiKey.trim()) {
    s.hunterApiKeyEnc = encryptSecret(parsed.data.hunterApiKey.trim());
  }
  if (parsed.data.clearApolloApiKey) {
    delete s.apolloApiKeyEnc;
  } else if (typeof parsed.data.apolloApiKey === "string" && parsed.data.apolloApiKey.trim()) {
    s.apolloApiKeyEnc = encryptSecret(parsed.data.apolloApiKey.trim());
  }
  // Voz IA (ElevenLabs)
  if (parsed.data.clearElevenLabsApiKey) {
    delete s.elevenLabsApiKeyEnc;
  } else if (typeof parsed.data.elevenLabsApiKey === "string" && /^[A-Za-z0-9_\-]{8,}$/.test(parsed.data.elevenLabsApiKey.trim())) {
    // Solo guarda si parece una key real (evita pisar la guardada con autofill).
    s.elevenLabsApiKeyEnc = encryptSecret(parsed.data.elevenLabsApiKey.trim());
  }
  if (typeof parsed.data.elevenLabsVoiceId === "string") {
    s.elevenLabsVoiceId = parsed.data.elevenLabsVoiceId.trim();
  }
  for (const k of [
    "whatsappProvider",
    "wahaSession",
    "evolutionInstance",
    "whatsappCountryCode",
    "notifyInterestedPhone",
    "ayuntamiento",
    "autoReplyEnabled",
    "autoReplyText",
    "autoFollowupEnabled",
    "followupTaskEnabled",
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
    "warmupChatEnabled",
    "principalPhone",
    "wahaProxy",
    "voiceSpeed",
    "voiceShorten",
    "voiceMaxSeconds",
    "autoRecoveryEnabled",
    "dailyJitterPct",
    "blockLinksInFirstMessage",
    "replyRateGuardEnabled",
    "jobsReviewMode",
    "channels"
  ] as const) {
    if (parsed.data[k] !== undefined) s[k] = parsed.data[k];
  }
  // Calentamiento por teléfono: cada canal conserva (o estrena) su addedAt, así
  // un número nuevo arranca su propia rampa anti-baneo aunque la cuenta sea
  // antigua. Preservamos el addedAt existente por nombre; los nuevos se sellan.
  if (parsed.data.channels !== undefined) {
    const prev: any[] = Array.isArray((ws?.settings as any)?.leads?.channels)
      ? (ws!.settings as any).leads.channels
      : [];
    const prevById = new Map(prev.map((c: any) => [c?.name, c]));
    const nowIso = new Date().toISOString();
    s.channels = parsed.data.channels.map((c) => ({
      ...c,
      addedAt: c.addedAt || prevById.get(c.name)?.addedAt || nowIso
    }));
  }
  // Número principal: si cambia (típico tras un baneo, cuando enchufas otra
  // SIM), reinicia su rampa de calentamiento sellando principalSince = ahora,
  // para que arranque enviando poco e ir subiendo. Si se borra, limpia la marca.
  if (parsed.data.principalPhone !== undefined) {
    const norm = (v: any) => String(v ?? "").replace(/\D/g, "");
    if (norm(parsed.data.principalPhone) !== norm(prevPrincipalPhone)) {
      s.principalSince = parsed.data.principalPhone ? new Date().toISOString() : null;
    }
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
