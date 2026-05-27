/**
 * Gestión de links de aprobación pública para clientes.
 * - GET: lista links existentes para un cliente/mes
 * - POST: crea un nuevo link
 * Solo miembros del workspace (admin típicamente).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const createSchema = z.object({
  clientId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  expiresInDays: z.number().int().min(1).max(180).default(30)
});

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId") ?? undefined;
  const month = url.searchParams.get("month") ?? undefined;

  const where: any = { workspaceId: api.workspaceId, revokedAt: null };
  if (clientId) where.clientId = clientId;
  if (month) where.month = month;

  const links = await prisma.clientApprovalLink.findMany({
    where,
    orderBy: { createdAt: "desc" }
  });
  return NextResponse.json({ items: links });
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  // Verificar cliente
  const client = await prisma.client.findFirst({
    where: { id: parsed.data.clientId, workspaceId: api.workspaceId, deletedAt: null }
  });
  if (!client) throw new ApiError(404, "client_not_found", "Cliente no encontrado");

  const expiresAt = new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000);
  const link = await prisma.clientApprovalLink.create({
    data: {
      workspaceId: api.workspaceId,
      clientId: parsed.data.clientId,
      month: parsed.data.month,
      createdById: api.userId,
      expiresAt
    }
  });
  return NextResponse.json(link, { status: 201 });
});
