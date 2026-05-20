/**
 * GET  /api/v1/gmb/clients  → lista de fichas con agregados (reseñas, media, sin responder, tags)
 * POST /api/v1/gmb/clients  → crea una ficha
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { logGmbActivity } from "@/lib/integrations/gmb-hub";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const clients = await prisma.gmbClient.findMany({
    where: { workspaceId: api.workspaceId },
    orderBy: { createdAt: "desc" },
    include: { clientTags: { include: { tag: true } } }
  });
  // Agregados de reseñas por ficha (sin responder = reviewReply null/"")
  const ids = clients.map((c) => c.id);
  const unrepliedRows = ids.length
    ? await prisma.gmbReview.groupBy({
        by: ["clientId"],
        where: { clientId: { in: ids }, OR: [{ reviewReply: null }, { reviewReply: "" }] },
        _count: { _all: true }
      })
    : [];
  const unrepliedMap = new Map(unrepliedRows.map((r) => [r.clientId, r._count._all]));

  return NextResponse.json({
    clients: clients.map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      description: c.description,
      tone: c.tone,
      accountId: c.accountId,
      locationId: c.locationId,
      emails: c.emails,
      mainKeyword: c.mainKeyword,
      autoReply: c.autoReply,
      frequency: c.frequency,
      scenarioId: c.scenarioId,
      status: c.status,
      rating: c.rating,
      reviewCount: c.reviewCount,
      unreplied: unrepliedMap.get(c.id) ?? 0,
      tags: c.clientTags.map((ct) => ({ id: ct.tag.id, name: ct.tag.name, color: ct.tag.color })),
      createdAt: c.createdAt
    }))
  });
});

const createSchema = z.object({
  name: z.string().min(1).max(255),
  category: z.string().max(100).optional(),
  description: z.string().optional(),
  tone: z.string().max(50).optional(),
  customTone: z.string().optional(),
  accountId: z.string().optional(),
  locationId: z.string().optional(),
  emails: z.string().optional(),
  mainKeyword: z.string().optional(),
  connectionId: z.string().optional(),
  frequency: z.number().int().min(1).max(1440).optional()
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const d = parsed.data;
  const client = await prisma.gmbClient.create({
    data: {
      workspaceId: api.workspaceId,
      name: d.name,
      category: d.category ?? "",
      description: d.description ?? null,
      tone: d.tone ?? "profesional",
      customTone: d.customTone ?? null,
      accountId: d.accountId ?? "",
      locationId: d.locationId ?? "",
      emails: d.emails ?? "",
      mainKeyword: d.mainKeyword ?? "",
      connectionId: d.connectionId ?? "",
      frequency: d.frequency ?? 15
    }
  });
  await logGmbActivity({
    workspaceId: api.workspaceId,
    clientId: client.id,
    actionType: "created",
    description: `Ficha "${client.name}" creada`
  });
  return NextResponse.json({ client });
});
