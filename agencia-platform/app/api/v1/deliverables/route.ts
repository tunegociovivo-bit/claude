/**
 * Entregables del workspace. Un entregable es cualquier pieza que la
 * agencia entrega al cliente y necesita su visto bueno (PDF de
 * propuesta, mockup, vídeo…). El cliente los aprueba/rechaza desde
 * el portal vía /api/public/approval/[token].
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { auditFromReq } from "@/lib/audit/log";

const createSchema = z.object({
  clientId: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  fileId: z.string().optional(),
  dueAt: z.string().datetime().optional()
});

export const GET = withApi({ scope: "tasks:read" }, async (req, { api }) => {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;

  const where: any = { workspaceId: api.workspaceId };
  if (clientId) where.clientId = clientId;
  if (status) where.status = status;

  const items = await prisma.deliverable.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      client: { select: { id: true, name: true } },
      file: { select: { id: true, name: true, mimeType: true, sizeBytes: true } },
      decisions: { orderBy: { createdAt: "desc" }, take: 5 },
      _count: { select: { decisions: true } }
    }
  });
  return NextResponse.json({ items });
});

export const POST = withApi({ scope: "tasks:write" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Se requiere usuario autenticado");
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  // El client debe pertenecer al workspace.
  const client = await prisma.client.findFirst({
    where: { id: parsed.data.clientId, workspaceId: api.workspaceId, deletedAt: null },
    select: { id: true }
  });
  if (!client) throw new ApiError(404, "client_not_found", "Cliente no encontrado");

  // Si llega fileId, también debe pertenecer al workspace.
  if (parsed.data.fileId) {
    const file = await prisma.file.findFirst({
      where: { id: parsed.data.fileId, workspaceId: api.workspaceId },
      select: { id: true }
    });
    if (!file) throw new ApiError(404, "file_not_found", "Archivo no encontrado");
  }

  const d = await prisma.deliverable.create({
    data: {
      workspaceId: api.workspaceId,
      clientId: parsed.data.clientId,
      title: parsed.data.title,
      description: parsed.data.description,
      fileId: parsed.data.fileId,
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
      createdById: api.userId
    },
    include: {
      client: { select: { id: true, name: true } },
      file: { select: { id: true, name: true, mimeType: true } }
    }
  });
  auditFromReq(req, api, {
    action: "deliverable.create",
    targetType: "DELIVERABLE",
    targetId: d.id,
    after: { title: d.title, clientId: d.clientId }
  });
  return NextResponse.json(d, { status: 201 });
});
