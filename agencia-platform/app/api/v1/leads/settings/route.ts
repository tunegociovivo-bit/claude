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
  return NextResponse.json({
    googleConfigured: !!s.googleApiKey,
    wahaUrl: s.wahaUrl ?? null,
    wahaConfigured: !!s.wahaApiKey,
    wahaSession: s.wahaSession ?? "default",
    whatsappCountryCode: s.whatsappCountryCode ?? "34",
    sendEnabled: s.sendEnabled ?? true,
    sendPaused: s.sendPaused ?? false,
    sendWindowStart: s.sendWindowStart ?? "09:00",
    sendWindowEnd: s.sendWindowEnd ?? "20:00",
    sendDelayMinSec: s.sendDelayMinSec ?? 60,
    sendDelayMaxSec: s.sendDelayMaxSec ?? 180,
    sendOnWeekends: s.sendOnWeekends ?? false,
    dailyLimit: s.dailyLimit ?? 80,
    enableVariations: s.enableVariations ?? true,
    maxAttempts: s.maxAttempts ?? 3,
    webhookToken: s.webhookToken
  });
});

const schema = z.object({
  googleApiKey: z.string().nullable().optional(),
  wahaUrl: z.string().url().or(z.literal("")).nullable().optional(),
  wahaApiKey: z.string().nullable().optional(),
  wahaSession: z.string().optional(),
  whatsappCountryCode: z.string().regex(/^\d{1,3}$/).optional(),
  sendEnabled: z.boolean().optional(),
  sendPaused: z.boolean().optional(),
  sendWindowStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  sendWindowEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  sendDelayMinSec: z.number().int().min(0).max(3600).optional(),
  sendDelayMaxSec: z.number().int().min(0).max(3600).optional(),
  sendOnWeekends: z.boolean().optional(),
  dailyLimit: z.number().int().min(1).max(10000).optional(),
  enableVariations: z.boolean().optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
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

  if (parsed.data.googleApiKey !== undefined) {
    if (parsed.data.googleApiKey === null || parsed.data.googleApiKey === "") {
      delete s.googleApiKey;
    } else {
      s.googleApiKey = encryptSecret(parsed.data.googleApiKey);
    }
  }
  if (parsed.data.wahaUrl !== undefined) {
    s.wahaUrl = parsed.data.wahaUrl || null;
  }
  if (parsed.data.wahaApiKey !== undefined) {
    if (parsed.data.wahaApiKey === null || parsed.data.wahaApiKey === "") {
      delete s.wahaApiKey;
    } else {
      s.wahaApiKey = encryptSecret(parsed.data.wahaApiKey);
    }
  }
  for (const k of [
    "wahaSession",
    "whatsappCountryCode",
    "sendEnabled",
    "sendPaused",
    "sendWindowStart",
    "sendWindowEnd",
    "sendDelayMinSec",
    "sendDelayMaxSec",
    "sendOnWeekends",
    "dailyLimit",
    "enableVariations",
    "maxAttempts"
  ] as const) {
    if (parsed.data[k] !== undefined) s[k] = parsed.data[k];
  }
  if (parsed.data.rotateWebhookToken) {
    s.webhookToken = randomBytes(24).toString("hex");
  }
  await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } });
  return NextResponse.json({ ok: true, webhookToken: s.webhookToken });
});
