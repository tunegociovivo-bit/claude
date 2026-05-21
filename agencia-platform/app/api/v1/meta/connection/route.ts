/**
 * GET    /api/v1/meta/connection → estado actual ({connected, metaUserId, expiresAt})
 * POST   /api/v1/meta/connection → guarda/actualiza token (body: {accessToken, expiresAt?})
 * DELETE /api/v1/meta/connection → borra la conexión
 *
 * Token cifrado en BD con NEXTAUTH_SECRET (encryptSecret). Antes de
 * guardarlo hacemos un ping a /me — si el token está mal, devolvemos
 * 400 con el mensaje de Meta para que el user vea el motivo en el
 * sitio (token caducado, sin scope, etc.).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import {
  deleteMetaConnection,
  pingMetaToken,
  readWorkspaceMetaToken,
  saveMetaToken
} from "@/lib/meta/connection";
import { auditFromReq } from "@/lib/audit/log";

export const dynamic = "force-dynamic";

export const GET = withApi({}, async (_req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const conn = await prisma.metaConnection.findUnique({
    where: { userId_workspaceId: { userId: api.userId, workspaceId: api.workspaceId } }
  });
  // Conexión propia del usuario y vigente.
  if (conn && !(conn.expiresAt && conn.expiresAt < new Date())) {
    return NextResponse.json({
      connected: true,
      metaUserId: conn.metaUserId,
      expiresAt: conn.expiresAt,
      createdAt: conn.createdAt
    });
  }
  // Sin conexión propia (o caducada): si el workspace ya tiene un token
  // permanente guardado (System User que no caduca, o ad-hoc), seguimos
  // "conectados" — se crearán las campañas con ese token sin tener que
  // volver a pegarlo.
  const wsToken = await readWorkspaceMetaToken(api.workspaceId);
  if (wsToken) {
    return NextResponse.json({ connected: true, shared: true });
  }
  return NextResponse.json({ connected: false });
});

const postSchema = z.object({
  accessToken: z.string().min(20),
  expiresAt: z.string().datetime().optional()
});

export const POST = withApi({ rate: "destructive" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const raw = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const ping = await pingMetaToken(parsed.data.accessToken);
  if (!ping.ok) {
    throw new ApiError(400, "bad_token", `Meta rechaza el token: ${ping.error ?? "?"}`);
  }

  const saved = await saveMetaToken({
    userId: api.userId,
    workspaceId: api.workspaceId,
    accessToken: parsed.data.accessToken,
    metaUserId: ping.metaUserId,
    expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null
  });

  auditFromReq(req, api, {
    action: "meta.connection_saved",
    targetType: "META_CONNECTION",
    targetId: saved.id,
    meta: { metaUserId: ping.metaUserId, metaUserName: ping.name }
  });

  return NextResponse.json({
    ok: true,
    metaUserId: ping.metaUserId,
    metaUserName: ping.name
  });
});

export const DELETE = withApi({ rate: "destructive" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  await deleteMetaConnection(api.userId, api.workspaceId);
  auditFromReq(req, api, {
    action: "meta.connection_deleted",
    targetType: "META_CONNECTION"
  });
  return NextResponse.json({ ok: true });
});
