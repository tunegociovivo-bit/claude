/**
 * GET /api/v1/admin/voice-settings → estado de la config de voz (Vapi)
 * PUT /api/v1/admin/voice-settings → guarda apiKey (cifrada), phoneNumberId, assistantId
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { encryptSecret } from "@/lib/ai/crypto";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "admin" }, async (req, { api }) => {
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId }, select: { settings: true } });
  const v = (ws?.settings as any)?.integrations?.voice ?? {};
  const baseUrl = process.env.NEXTAUTH_URL ?? new URL(req.url).origin;
  return NextResponse.json({
    hasApiKey: !!(v.apiKeyEnc || process.env.VAPI_API_KEY),
    phoneNumberId: v.phoneNumberId ?? null,
    assistantId: v.assistantId ?? null,
    webhookUrl: `${baseUrl.replace(/\/+$/, "")}/api/v1/voice/webhook`
  });
});

export const PUT = withApi({ scope: "admin" }, async (req, { api }) => {
  const body = await req.json().catch(() => ({}));
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId }, select: { settings: true } });
  const settings: any = ws?.settings ?? {};
  settings.integrations = settings.integrations ?? {};
  const v = settings.integrations.voice ?? {};
  if (typeof body.apiKey === "string" && body.apiKey.trim()) v.apiKeyEnc = encryptSecret(body.apiKey.trim());
  if (typeof body.phoneNumberId === "string") v.phoneNumberId = body.phoneNumberId.trim() || undefined;
  if (typeof body.assistantId === "string") v.assistantId = body.assistantId.trim() || undefined;
  settings.integrations.voice = v;
  await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } });
  return NextResponse.json({ ok: true });
});
