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
  settings.integrations.gmb = g;
  await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } });
  return NextResponse.json({ ok: true });
});
