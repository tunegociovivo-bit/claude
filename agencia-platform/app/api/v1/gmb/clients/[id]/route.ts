/**
 * GET    /api/v1/gmb/clients/[id]  → ficha
 * PATCH  /api/v1/gmb/clients/[id]  → actualiza campos
 * DELETE /api/v1/gmb/clients/[id]  → borra ficha
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { logGmbActivity } from "@/lib/integrations/gmb-hub";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const client = await prisma.gmbClient.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    include: { clientTags: { include: { tag: true } } }
  });
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  return NextResponse.json({ client });
});

const updateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  category: z.string().max(100).optional(),
  description: z.string().nullable().optional(),
  tone: z.string().max(50).optional(),
  customTone: z.string().nullable().optional(),
  accountId: z.string().optional(),
  locationId: z.string().optional(),
  emails: z.string().optional(),
  mainKeyword: z.string().optional(),
  autoReply: z.enum(["manual", "auto"]).optional(),
  connectionId: z.string().optional(),
  frequency: z.number().int().min(1).max(1440).optional(),
  scenarioId: z.string().optional(),
  status: z.enum(["active", "paused"]).optional(),
  placeId: z.string().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  phone: z.string().optional(),
  website: z.string().optional(),
  address: z.string().optional()
});

export const PATCH = withApi({ scope: "*" }, async (req, { params, api }) => {
  const existing = await prisma.gmbClient.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: { id: true }
  });
  if (!existing) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const client = await prisma.gmbClient.update({ where: { id: params.id }, data: parsed.data });
  return NextResponse.json({ client });
});

export const DELETE = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const existing = await prisma.gmbClient.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: { id: true, name: true }
  });
  if (!existing) throw new ApiError(404, "not_found", "Ficha no encontrada");
  await logGmbActivity({
    workspaceId: api.workspaceId,
    clientId: existing.id,
    actionType: "deleted",
    description: `Ficha "${existing.name}" eliminada`
  });
  await prisma.gmbClient.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
});
