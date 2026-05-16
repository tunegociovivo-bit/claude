import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { clientCreateSchema } from "@/lib/api/schemas";

export const GET = withApi({ scope: "clients:read" }, async (req, { api }) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  // Default 500 y cap 500. Las UIs (TopBar, Sidebar, EditorialClient,
  // ProyectosClient, redactor…) necesitan TODOS los clientes para
  // dropdowns. Antes el default 50 cortaba y se perdían los más
  // antiguos al haber muchos.
  const take = Math.min(Number(url.searchParams.get("limit") ?? 500), 500);
  const skip = Number(url.searchParams.get("offset") ?? 0);

  const where: any = { workspaceId: api.workspaceId, deletedAt: null };
  if (status) where.status = status;

  const [items, total] = await Promise.all([
    prisma.client.findMany({ where, take, skip, orderBy: { createdAt: "desc" } }),
    prisma.client.count({ where })
  ]);

  return NextResponse.json({ items, total, limit: take, offset: skip });
});

export const POST = withApi({ scope: "clients:write" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = clientCreateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const client = await prisma.client.create({
    data: { ...parsed.data, workspaceId: api.workspaceId, since: new Date() }
  });
  return NextResponse.json(client, { status: 201 });
});
