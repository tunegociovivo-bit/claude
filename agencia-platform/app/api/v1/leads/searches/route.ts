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
  source: z
    .enum(["places", "borme", "trustpilot", "doctoralia", "idealista", "fotocasa", "linkedin"])
    .optional()
    .default("places"),
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

  // Para fuente "places" la localidad es obligatoria en scope=custom. Para
  // fuente "borme" puede venir vacía (filtra por provincia si llega, o
  // saca todas las constituciones del país si no).
  if (
    parsed.data.source === "places" &&
    parsed.data.scope === "custom" &&
    !parsed.data.location.trim()
  ) {
    throw new ApiError(400, "missing_location", "Falta la provincia / localidad");
  }

  const out = await startSearch({
    workspaceId: api.workspaceId,
    userId: api.userId,
    keyword: parsed.data.keyword,
    location: parsed.data.location,
    scope: parsed.data.scope,
    source: parsed.data.source,
    skipExisting: parsed.data.skipExisting
  });
  return NextResponse.json(out, { status: 201 });
});
