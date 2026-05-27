/**
 * GET  /api/v1/admin/fal-settings  → ¿hay FAL_KEY guardada?
 * PUT  /api/v1/admin/fal-settings  → guarda la FAL_KEY cifrada
 * DELETE                            → la borra
 *
 * FAL_KEY (fal.ai) para generación de vídeos del calendario editorial.
 * Se guarda cifrada en Workspace.settings.integrations.fal.apiKeyEnc.
 * generate-video la lee de ahí (prioridad sobre env var).
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
  const enc = (ws?.settings as any)?.integrations?.fal?.apiKeyEnc;
  return NextResponse.json({
    hasKey: !!enc || !!process.env.FAL_KEY || !!process.env.FAL_API_KEY
  });
});

export const PUT = withApi({ scope: "admin" }, async (req, { api }) => {
  const body = await req.json().catch(() => ({}));
  const key = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  if (!key || key.length < 10) {
    throw new ApiError(400, "invalid_key", "Pega una FAL_KEY válida (formato id:secret).");
  }
  const ws = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { settings: true }
  });
  const settings: any = ws?.settings ?? {};
  if (!settings.integrations) settings.integrations = {};
  if (!settings.integrations.fal) settings.integrations.fal = {};
  settings.integrations.fal.apiKeyEnc = encryptSecret(key);
  await prisma.workspace.update({
    where: { id: api.workspaceId },
    data: { settings }
  });
  return NextResponse.json({ ok: true });
});

export const DELETE = withApi({ scope: "admin" }, async (_req, { api }) => {
  const ws = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { settings: true }
  });
  const settings: any = ws?.settings ?? {};
  if (settings?.integrations?.fal) {
    delete settings.integrations.fal;
    await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } });
  }
  return NextResponse.json({ ok: true });
});
