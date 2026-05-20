/**
 * GET /api/v1/admin/gmb-settings → config de GMB Hub (enmascarada) + URL del webhook entrante
 * PUT /api/v1/admin/gmb-settings → guarda webhookToken, replyWebhookUrl, mapsKey, scraperApiKey
 *
 * Todo en Workspace.settings.integrations.gmb. El webhookToken y la mapsKey/
 * scraperApiKey se guardan cifradas; la replyWebhookUrl en claro (es una URL).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { encryptSecret, decryptSecret, maskSecret } from "@/lib/ai/crypto";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "admin" }, async (req, { api }) => {
  const ws = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { settings: true }
  });
  const g = (ws?.settings as any)?.integrations?.gmb ?? {};
  const tokenPlain = g.webhookTokenEnc ? decryptSecret(g.webhookTokenEnc) : g.webhookToken ?? null;
  const baseUrl = process.env.NEXTAUTH_URL ?? new URL(req.url).origin;
  return NextResponse.json({
    hasWebhookToken: !!tokenPlain,
    webhookTokenMasked: tokenPlain ? maskSecret(tokenPlain) : null,
    replyWebhookUrl: g.replyWebhookUrl ?? null,
    hasMapsKey: !!(g.mapsKeyEnc || process.env.GOOGLE_MAPS_API_KEY),
    hasScraperKey: !!g.scraperApiKeyEnc,
    notifyEmail: g.notifyEmail ?? null,
    hasTelegram: !!g.telegramEnc,
    make: {
      templateId: g.makeTemplateId ?? null,
      gmbConn: g.makeGmbConn ?? null,
      openaiConn: g.makeOpenaiConn ?? null,
      gmailAcct: g.makeGmailAcct ?? null,
      sheetsConn: g.makeSheetsConn ?? null
    },
    // URL que el usuario configura en Make para empujar reseñas
    incomingWebhookUrl: `${baseUrl.replace(/\/+$/, "")}/api/v1/gmb/reviews/webhook`,
    workspaceId: api.workspaceId
  });
});

export const PUT = withApi({ scope: "admin" }, async (req, { api }) => {
  const body = await req.json().catch(() => ({}));
  const ws = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { settings: true }
  });
  const settings: any = ws?.settings ?? {};
  settings.integrations = settings.integrations ?? {};
  const g = settings.integrations.gmb ?? {};

  if (typeof body.webhookToken === "string" && body.webhookToken.trim()) {
    g.webhookTokenEnc = encryptSecret(body.webhookToken.trim());
    delete g.webhookToken; // limpiar legacy en claro
  }
  if (typeof body.replyWebhookUrl === "string") {
    g.replyWebhookUrl = body.replyWebhookUrl.trim() || undefined;
  }
  if (typeof body.mapsKey === "string" && body.mapsKey.trim()) {
    g.mapsKeyEnc = encryptSecret(body.mapsKey.trim());
  }
  if (typeof body.scraperApiKey === "string" && body.scraperApiKey.trim()) {
    g.scraperApiKeyEnc = encryptSecret(body.scraperApiKey.trim());
  }
  if (typeof body.notifyEmail === "string") {
    g.notifyEmail = body.notifyEmail.trim() || undefined;
  }
  if (typeof body.telegram === "string" && body.telegram.trim()) {
    g.telegramEnc = encryptSecret(body.telegram.trim());
  }
  // IDs de la plantilla de Make para auto-crear escenarios por ficha (no secretos)
  for (const [key, field] of [
    ["makeTemplateId", "makeTemplateId"],
    ["makeGmbConn", "makeGmbConn"],
    ["makeOpenaiConn", "makeOpenaiConn"],
    ["makeGmailAcct", "makeGmailAcct"],
    ["makeSheetsConn", "makeSheetsConn"]
  ] as const) {
    if (typeof body[key] === "string") g[field] = body[key].trim() || undefined;
  }
  settings.integrations.gmb = g;
  await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } });
  return NextResponse.json({ ok: true });
});
