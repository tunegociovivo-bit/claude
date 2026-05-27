/**
 * GET/PATCH /api/v1/admin/wordpress-credentials
 *
 * Persiste las credenciales del WordPress origen (URL + usuario +
 * Application Password) en workspace.settings.integrations.wordpress
 * para que la sección /admin/wp-import las use por defecto sin que el
 * usuario tenga que pegarlas en cada import, y para que aparezcan en
 * el bloque de credenciales de /admin/seguridad.
 *
 * El App Password se cifra con AES-256-GCM (misma crypto que el resto
 * de keys del workspace).
 *
 * Solo admins.
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
  const wp = (ws?.settings as any)?.integrations?.wordpress ?? {};
  return NextResponse.json({
    url: wp.url ?? null,
    user: wp.user ?? null,
    hasPassword: !!wp.appPasswordEncrypted
  });
});

const schema = z.object({
  url: z.string().url().or(z.literal("")).nullable().optional(),
  user: z.string().min(1).max(120).nullable().optional(),
  appPassword: z.string().nullable().optional()
});

export const PATCH = withApi({ scope: "*" }, async (req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings: any = ws?.settings ?? {};
  settings.integrations = settings.integrations ?? {};
  settings.integrations.wordpress = settings.integrations.wordpress ?? {};
  const wp = settings.integrations.wordpress;

  if (parsed.data.url !== undefined) wp.url = parsed.data.url || null;
  if (parsed.data.user !== undefined) wp.user = parsed.data.user || null;
  if (parsed.data.appPassword !== undefined) {
    if (parsed.data.appPassword === null || parsed.data.appPassword === "") {
      delete wp.appPasswordEncrypted;
    } else {
      // Normalizar: WP muestra las app passwords con espacios cada 4 chars;
      // los aceptamos así o sin espacios.
      const clean = parsed.data.appPassword.replace(/\s+/g, "");
      wp.appPasswordEncrypted = encryptSecret(clean);
    }
  }

  await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } });
  return NextResponse.json({ ok: true });
});
