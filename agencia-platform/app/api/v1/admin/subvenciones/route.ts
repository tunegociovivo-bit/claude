/**
 * GET /api/v1/admin/subvenciones
 * Estado del catálogo + lista de convocatorias abiertas + clientes (para el
 * selector del cruce).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const now = new Date();
  const [abiertas, total, ultima, convocatorias, clients] = await Promise.all([
    prisma.subvencionConvocatoria.count({ where: { abierta: true, OR: [{ fechaFin: null }, { fechaFin: { gte: now } }] } }),
    prisma.subvencionConvocatoria.count(),
    prisma.subvencionConvocatoria.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    prisma.subvencionConvocatoria.findMany({
      where: { abierta: true, OR: [{ fechaFin: null }, { fechaFin: { gte: now } }] },
      orderBy: { fechaFin: "asc" },
      take: 100,
      select: { id: true, titulo: true, organo: true, regiones: true, importeTotal: true, fechaFin: true, urlBases: true }
    }),
    prisma.client.findMany({ where: { workspaceId: api.workspaceId }, orderBy: { name: "asc" }, select: { id: true, name: true } })
  ]);
  return NextResponse.json({
    abiertas,
    total,
    ultimaActualizacion: ultima?.updatedAt ?? null,
    convocatorias,
    clients
  });
});
