import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { startSearch } from "@/lib/leads/search-manager";

const createSchema = z.object({
  keyword: z.string().min(2).max(120),
  location: z.string().max(120).optional().default(""),
  scope: z.enum(["custom", "spain"]).default("custom"),
  // Búsqueda incremental + dedup cross-keyword: saltar leads cuyo placeId
  // ya esté en otra búsqueda del workspace.
  skipExisting: z.boolean().optional().default(false),
  // Legacy field, ignorado si llega
  provincesScope: z.array(z.string()).optional()
});

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const items = await prisma.leadSearch.findMany({
    where: { workspaceId: api.workspaceId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { leads: true } } },
    take: 200
  });
  return NextResponse.json({ items });
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  if (parsed.data.scope === "custom" && !parsed.data.location.trim()) {
    throw new ApiError(400, "missing_location", "Falta la provincia / localidad");
  }

  const out = await startSearch({
    workspaceId: api.workspaceId,
    userId: api.userId,
    keyword: parsed.data.keyword,
    location: parsed.data.location,
    scope: parsed.data.scope,
    skipExisting: parsed.data.skipExisting
  });
  return NextResponse.json(out, { status: 201 });
});
