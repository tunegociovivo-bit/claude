/**
 * GET    /api/v1/admin/ai-agent/memory/:clientId  → lee memoria
 * PUT    /api/v1/admin/ai-agent/memory/:clientId  → reemplaza contenido
 *                                                    body: { content: string }
 * DELETE /api/v1/admin/ai-agent/memory/:clientId  → borra entera
 *
 * Sólo admin del workspace.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";
import { setClientMemory } from "@/lib/ai/nv-ia/client-memory";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const client = await prisma.client.findFirst({
    where: { id: params.clientId, workspaceId: api.workspaceId },
    select: { id: true, name: true }
  });
  if (!client) throw new ApiError(404, "not_found", "Cliente no encontrado");
  const mem = await prisma.aiClientMemory.findUnique({ where: { clientId: params.clientId } });
  return NextResponse.json({
    client,
    content: mem?.content ?? "",
    updatedBy: mem?.updatedBy ?? null,
    updatedAt: mem?.updatedAt ?? null
  });
});

const putSchema = z.object({ content: z.string().max(60_000) });

export const PUT = withApi({ scope: "*" }, async (req, { params, api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const r = await setClientMemory({
    workspaceId: api.workspaceId,
    clientId: params.clientId,
    content: parsed.data.content,
    by: `user:${api.userId}`
  });
  if (!r.ok) throw new ApiError(400, "memory_error", r.error);
  return NextResponse.json({ ok: true, size: r.size });
});

export const DELETE = withApi({ scope: "*", rate: "destructive" }, async (_req, { params, api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  await prisma.aiClientMemory.deleteMany({
    where: { clientId: params.clientId, workspaceId: api.workspaceId }
  });
  return NextResponse.json({ ok: true });
});
