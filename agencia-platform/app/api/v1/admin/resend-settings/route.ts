/**
 * GET    /api/v1/admin/resend-settings → ¿hay clave de Resend? + remitente
 * PUT    /api/v1/admin/resend-settings → guarda la API key (cifrada) + from
 * DELETE                                → la borra
 *
 * Resend es el relay de envío por HTTP (puerto 443) que usamos cuando el
 * SMTP del hosting está bloqueado (Railway corta 465/587/25). Se guarda
 * cifrada en Workspace.settings.integrations.resend.apiKeyEnc. El envío de
 * correo de Sonia (lib/integrations/email-account.ts) la lee de ahí con
 * prioridad sobre la env var RESEND_API_KEY.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { encryptSecret } from "@/lib/ai/crypto";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "admin" }, async (_req, { api }) => {
  const ws = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { settings: true }
  });
  const r = (ws?.settings as any)?.integrations?.resend;
  return NextResponse.json({
    hasKey: !!r?.apiKeyEnc || !!process.env.RESEND_API_KEY,
    from: r?.from ?? process.env.EMAIL_FROM ?? null
  });
});

export const PUT = withApi({ scope: "admin" }, async (req, { api }) => {
  const body = await req.json().catch(() => ({}));
  const key = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  const from = typeof body?.from === "string" ? body.from.trim() : "";
  if (key && key.length < 10) {
    throw new ApiError(400, "invalid_key", "Pega una API key de Resend válida (empieza por 're_').");
  }
  const ws = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { settings: true }
  });
  const settings: any = ws?.settings ?? {};
  if (!settings.integrations) settings.integrations = {};
  if (!settings.integrations.resend) settings.integrations.resend = {};
  if (key) settings.integrations.resend.apiKeyEnc = encryptSecret(key);
  if (from) settings.integrations.resend.from = from;
  await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } });
  return NextResponse.json({ ok: true });
});

export const DELETE = withApi({ scope: "admin" }, async (_req, { api }) => {
  const ws = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { settings: true }
  });
  const settings: any = ws?.settings ?? {};
  if (settings?.integrations?.resend) {
    delete settings.integrations.resend;
    await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } });
  }
  return NextResponse.json({ ok: true });
});
