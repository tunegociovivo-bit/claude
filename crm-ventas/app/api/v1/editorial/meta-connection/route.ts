/**
 * Conexión del negocio con Facebook/Instagram (token de Meta pegado a mano).
 *
 * GET    → estado ({ connected, connections[] }) SIN revelar el token.
 * POST   → guarda/actualiza el token (body: { accessToken, expiresAt? }).
 *          Antes de guardarlo se comprueba contra /me de Meta: si el token
 *          está mal, devolvemos 400 con el motivo que da Meta.
 * DELETE → borra la conexión (?connectionId=… o todas).
 *
 * Portado de app/api/v1/meta/connection del Hub. POST/DELETE solo para
 * administradores del negocio.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { deleteMetaConnection, pingMetaToken, saveMetaToken } from "@/lib/meta/connection";

export const dynamic = "force-dynamic";

export const GET = withApi({ module: "editorial" }, async (_req, { api }) => {
  const connections = await prisma.metaConnection.findMany({
    where: { workspaceId: api.workspaceId },
    select: { id: true, metaUserId: true, displayName: true, expiresAt: true, createdAt: true, updatedAt: true },
    orderBy: { updatedAt: "desc" }
  });
  const now = new Date();
  const items = connections.map((conn) => ({ ...conn, expired: !!conn.expiresAt && conn.expiresAt < now }));
  return NextResponse.json({
    connected: items.some((conn) => !conn.expired),
    connections: items,
    canManage: api.role === "ADMIN"
  });
});

const postSchema = z.object({
  accessToken: z.string().trim().min(20, "El token parece incompleto").max(2000),
  expiresAt: z.string().datetime().optional().nullable()
});

export const POST = withApi({ module: "editorial", admin: true, rate: "admin" }, async (req, { api }) => {
  const raw = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.issues[0]?.message ?? "Token no válido");

  const ping = await pingMetaToken(parsed.data.accessToken);
  if (!ping.ok) {
    throw new ApiError(400, "bad_token", `Meta rechaza el token: ${ping.error ?? "?"}`);
  }

  const saved = await saveMetaToken({
    userId: api.userId ?? null,
    workspaceId: api.workspaceId,
    accessToken: parsed.data.accessToken,
    metaUserId: ping.metaUserId,
    displayName: ping.name,
    expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null
  });

  return NextResponse.json({
    ok: true,
    id: saved.id,
    metaUserId: ping.metaUserId,
    metaUserName: ping.name
  });
});

export const DELETE = withApi({ module: "editorial", admin: true, rate: "admin" }, async (req, { api }) => {
  const connectionId = new URL(req.url).searchParams.get("connectionId") ?? undefined;
  const count = await deleteMetaConnection(api.workspaceId, connectionId);
  if (connectionId && count === 0) throw new ApiError(404, "not_found", "Conexión no encontrada");
  return NextResponse.json({ ok: true, deleted: count });
});
