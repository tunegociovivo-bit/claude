/**
 * Gestión de integraciones del workspace.
 * - Genera/regenera el webhook token para Evolution API.
 * - Devuelve estado de las integraciones (Drive, Metricool, Google Places, Evolution).
 *
 * Solo admins.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

async function requireAdmin(workspaceId: string, userId: string | undefined) {
  if (!userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const me = await prisma.membership.findFirst({ where: { workspaceId, userId } });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins");
}

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings = ((ws?.settings as any) ?? {}).integrations ?? {};
  return NextResponse.json({
    evolution: {
      hasToken: Boolean(settings.evolution?.webhookToken),
      webhookToken: settings.evolution?.webhookToken ?? null,
      hasUrl: Boolean(settings.evolution?.url),
      hasApiKey: Boolean(settings.evolution?.apiKeyEnc)
    },
    metricool: {
      hasBrand: Boolean(settings.metricool?.brand),
      hasToken: Boolean(settings.metricool?.tokenEnc),
      blogId: settings.metricool?.blogId ?? null
    },
    googlePlaces: {
      hasApiKey: Boolean(settings.googlePlaces?.apiKeyEnc)
    },
    drive: {
      folderRefs: settings.drive?.folderRefs ?? null
    }
  });
});

const actionSchema = z.object({
  action: z.enum(["regenerate_evolution_token", "clear_evolution_token"])
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);
  const body = await req.json().catch(() => null);
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings: any = (ws?.settings as any) ?? {};
  settings.integrations ??= {};
  settings.integrations.evolution ??= {};

  if (parsed.data.action === "regenerate_evolution_token") {
    // 32 chars hex = 128 bits de entropía, suficiente para un token de webhook
    const token = crypto.randomBytes(16).toString("hex");
    settings.integrations.evolution.webhookToken = token;
    await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } });
    return NextResponse.json({ ok: true, webhookToken: token });
  }

  if (parsed.data.action === "clear_evolution_token") {
    delete settings.integrations.evolution.webhookToken;
    await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } });
    return NextResponse.json({ ok: true });
  }

  throw new ApiError(400, "unknown_action", "Acción no soportada");
});
