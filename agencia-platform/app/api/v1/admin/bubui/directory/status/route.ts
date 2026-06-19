/**
 * GET /api/v1/admin/bubui/directory/status
 * Resumen del directorio Bubui para el panel admin: negocios activos, páginas
 * generadas (pares nicho+localidad), negocios sin geocodificar y nº de páginas
 * con contenido IA cacheado.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { getDirectoryIndex, getAllLocalities } from "@/lib/bubui/directory";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async () => {
  const [activeTotal, missingGeo, dir, localities, editorialCount] = await Promise.all([
    prisma.bubuiBusiness.count({ where: { active: true } }),
    prisma.bubuiBusiness.count({ where: { OR: [{ latitude: null }, { longitude: null }] } }),
    getDirectoryIndex(),
    getAllLocalities(),
    prisma.bubuiDirectoryContent.count()
  ]);

  return NextResponse.json({
    activeTotal,
    missingGeo,
    categories: dir.categories.length,
    localities: localities.length,
    pairs: dir.pairs.length,
    editorialGenerated: editorialCount,
    topPairs: dir.pairs.slice(0, 12)
  });
});
