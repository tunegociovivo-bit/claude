/**
 * GET  /api/v1/gmb/buscador/searches → búsquedas guardadas
 * POST /api/v1/gmb/buscador/searches → guarda { name, locations, keyword?, type?, radiusKm?, schedule? }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const searches = await prisma.gmbSearch.findMany({
    where: { workspaceId: api.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 50
  });
  return NextResponse.json({ searches });
});

const schema = z.object({
  name: z.string().min(1).max(120),
  locations: z.string().min(1).max(4000),
  keyword: z.string().max(120).optional(),
  type: z.string().max(60).optional(),
  radiusKm: z.number().min(0.5).max(50).optional(),
  schedule: z.enum(["none", "daily", "weekly", "monthly"]).optional()
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const search = await prisma.gmbSearch.create({
    data: {
      workspaceId: api.workspaceId,
      name: parsed.data.name,
      locations: parsed.data.locations,
      keyword: parsed.data.keyword ?? "",
      type: parsed.data.type ?? "",
      radiusKm: parsed.data.radiusKm ?? 3,
      schedule: parsed.data.schedule ?? "none",
      createdById: api.userId ?? null
    }
  });
  return NextResponse.json({ search });
});
