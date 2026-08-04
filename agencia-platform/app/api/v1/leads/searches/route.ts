import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { startSearch } from "@/lib/leads/search-manager";
import { availableSources } from "@/lib/leads/sources";

const createSchema = z.object({
  keyword: z.string().min(2).max(120),
  location: z.string().max(120).optional().default(""),
  // Municipio concreto (opcional). Si llega, se busca a fondo solo ahí. Si no
  // llega y `location` es una provincia, se iteran TODOS sus municipios.
  municipality: z.string().max(120).optional(),
  scope: z.enum(["custom", "spain"]).default("custom"),
  source: z
    .enum(["all", "places", "borme", "bdns", "meta_ads", "jobs", "trustpilot", "doctoralia", "idealista", "fotocasa", "linkedin"])
    .optional()
    .default("places"),
  skipExisting: z.boolean().optional().default(false),
  // Filtros opcionales por fuente. Para "places":
  //   { lowRatingOnly?: boolean, maxRating?: number, minReviewsCount?: number }
  sourceConfig: z.record(z.any()).optional(),
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

  // 🌐 "Atacar con todas las fuentes": crea una búsqueda por cada fuente lista
  // en este workspace (salta las que necesiten una key sin configurar).
  if (parsed.data.source === "all") {
    const hasLocation = !!parsed.data.location.trim() || parsed.data.scope === "spain";
    const sources = await availableSources(api.workspaceId, { hasLocation });
    const created: { searchId: string; source: string }[] = [];
    for (const src of sources) {
      try {
        const out = await startSearch({
          workspaceId: api.workspaceId,
          userId: api.userId,
          keyword: parsed.data.keyword,
          location: parsed.data.location,
          municipality: parsed.data.municipality,
          scope: parsed.data.scope,
          source: src,
          skipExisting: parsed.data.skipExisting,
          sourceConfig: parsed.data.sourceConfig
        });
        created.push({ searchId: out.searchId, source: src });
      } catch (e: any) {
        console.warn(`[searches all] ${src} falló:`, e?.message ?? e);
      }
    }
    if (created.length === 0) {
      throw new ApiError(409, "no_sources", "No hay ninguna fuente lista para lanzar (revisa keys en Ajustes).");
    }
    return NextResponse.json({ all: true, created, count: created.length }, { status: 201 });
  }

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
    municipality: parsed.data.municipality,
    scope: parsed.data.scope,
    source: parsed.data.source,
    skipExisting: parsed.data.skipExisting,
    sourceConfig: parsed.data.sourceConfig
  });
  return NextResponse.json(out, { status: 201 });
});
