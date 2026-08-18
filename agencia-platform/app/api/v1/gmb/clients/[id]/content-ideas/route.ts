/**
 * GET /api/v1/gmb/clients/[id]/content-ideas — borradores de contenido GBP (novedad/oferta/evento)
 * por categoría + salud de la cadencia de publicación + últimos posts. Borradores auditables (no
 * publica). Tenant-scoped. La publicación real la hace la cola de GmbPost por adapter/manual.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ensureGmbClient } from "@/lib/gmb/server";
import { contentIdeas, cadenceHealth } from "@/lib/gmb/content";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");

  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [postsLast30, recent] = await Promise.all([
    prisma.gmbPost.count({ where: { workspaceId: api.workspaceId, clientId: client.id, status: "published", publishedAt: { gte: since } } }),
    prisma.gmbPost.findMany({ where: { workspaceId: api.workspaceId, clientId: client.id }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, title: true, status: true, scheduledAt: true, publishedAt: true } })
  ]);

  return NextResponse.json({
    ok: true,
    ideas: contentIdeas({ category: client.category, name: client.name, keyword: client.mainKeyword || client.category }),
    cadence: cadenceHealth(postsLast30),
    recent
  });
});
