/**
 * GET /api/v1/gmb/clients/[id]/web-local — recomendaciones de web local (páginas/servicios/entidades)
 * y un BORRADOR de schema.org LocalBusiness (JSON-LD) coherente con el NAP canónico. Borradores
 * auditables: no aplica cambios externos. Tenant-scoped.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ensureGmbClient, getCanonicalNap } from "@/lib/gmb/server";
import { webRecommendations, buildLocalBusinessSchema } from "@/lib/gmb/web-local";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");

  const nap = await getCanonicalNap(prisma, api.workspaceId, client);
  const city = client.address ? String(client.address).split(",").pop()?.trim() ?? null : null;
  const recommendations = webRecommendations({ category: client.category, keyword: client.mainKeyword || client.category, city, hasWebsite: !!(client.website && String(client.website).trim()) });
  const schema = buildLocalBusinessSchema({ nap, category: client.category, city, lat: client.latitude, lng: client.longitude });

  return NextResponse.json({ ok: true, recommendations, schema, hasWebsite: !!(client.website && String(client.website).trim()) });
});
