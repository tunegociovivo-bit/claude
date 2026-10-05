/**
 * GET y PATCH de la ficha editorial de la marca del negocio (brief,
 * branding, colores, fuentes, refs visuales, plantillas, dimensiones por
 * formato y preset de «Generar mes con IA»).
 *
 * Portado de app/api/v1/clients/[id]/editorial-meta del Hub. En el CRM hay
 * una sola marca por workspace (ContentBrand), así que no lleva id.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ensureContentBrand, resignBrandAssets } from "@/lib/content/brand";
import { brandEditorialMetaSchema, BRAND_META_SELECT } from "@/lib/editorial/schemas";
import { persistBrandAssetUrl } from "@/lib/editorial/assets";

export const dynamic = "force-dynamic";

async function loadBrand(workspaceId: string) {
  const brand = await ensureContentBrand(workspaceId);
  const row = await prisma.contentBrand.findFirst({
    where: { id: brand.id, workspaceId },
    select: BRAND_META_SELECT
  });
  if (!row) throw new ApiError(404, "not_found", "Ficha de marca no encontrada");
  return resignBrandAssets(row, workspaceId);
}

export const GET = withApi({ module: "editorial" }, async (_req, { api }) => {
  return NextResponse.json(await loadBrand(api.workspaceId));
});

export const PATCH = withApi({ module: "editorial" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = brandEditorialMetaSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  // Normalizar: "" → null para los campos string opcionales
  const data: any = { ...parsed.data };
  for (const k of ["website", "logoUrl", "styleGuideCached", "industry", "imageGlobalAvoid"] as const) {
    if (data[k] === "") data[k] = null;
  }

  // Recursos de marca: deben ser archivos del propio negocio (o URLs
  // públicas) y se firman con validez larga para que no caduquen en BD.
  if (typeof data.logoUrl === "string") data.logoUrl = await persistBrandAssetUrl(data.logoUrl, api.workspaceId);
  for (const field of ["referenceImages", "patternTemplates", "fonts"] as const) {
    if (Array.isArray(data[field])) {
      data[field] = await Promise.all(
        data[field].map(async (item: { url: string }) => ({ ...item, url: await persistBrandAssetUrl(item.url, api.workspaceId) }))
      );
    }
  }

  const brand = await ensureContentBrand(api.workspaceId);
  const updated = await prisma.contentBrand.updateMany({
    where: { id: brand.id, workspaceId: api.workspaceId, deletedAt: null },
    data
  });
  if (updated.count === 0) throw new ApiError(404, "not_found", "Ficha de marca no encontrada");

  return NextResponse.json(await loadBrand(api.workspaceId));
});
