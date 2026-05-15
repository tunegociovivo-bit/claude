/**
 * Configuración global del módulo editorial:
 * - makeWebhookUrl: URL de Make/Zapier al aprobar mes.
 * - imageModel: modelo IA por defecto del workspace para imágenes.
 * - freepikApiKey: cifrada (solo se devuelve si está configurada,
 *   nunca el valor real).
 *
 * Persistido en workspace.settings.editorial. Sólo admins.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
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
  const settings: any = ws?.settings ?? {};
  return NextResponse.json({
    makeWebhookUrl: settings?.editorial?.makeWebhookUrl ?? null,
    imageModel: settings?.editorial?.imageModel ?? "openai-gpt-image-1",
    freepikConfigured: !!settings?.editorial?.freepikApiKey
  });
});

const schema = z.object({
  makeWebhookUrl: z.string().url().or(z.literal("")).nullable().optional(),
  imageModel: z.enum(["openai-gpt-image-1", "freepik-seedream-v4"]).optional(),
  // Pasar string para guardar (cifrada). Pasar null para borrar. Omitir = sin tocar.
  freepikApiKey: z.string().nullable().optional()
});

export const PATCH = withApi({ scope: "*" }, async (req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings: any = ws?.settings ?? {};
  settings.editorial = settings.editorial ?? {};

  if (parsed.data.makeWebhookUrl !== undefined) {
    settings.editorial.makeWebhookUrl = parsed.data.makeWebhookUrl || null;
  }
  if (parsed.data.imageModel !== undefined) {
    settings.editorial.imageModel = parsed.data.imageModel;
  }
  if (parsed.data.freepikApiKey !== undefined) {
    if (parsed.data.freepikApiKey === null || parsed.data.freepikApiKey === "") {
      delete settings.editorial.freepikApiKey;
    } else {
      settings.editorial.freepikApiKey = encryptSecret(parsed.data.freepikApiKey);
    }
  }

  await prisma.workspace.update({
    where: { id: api.workspaceId },
    data: { settings }
  });
  return NextResponse.json({ ok: true });
});
