/**
 * GET /api/v1/admin/subvenciones
 * Estado del catálogo + lista de convocatorias abiertas + clientes (para el
 * selector del cruce).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { getAgencyProfile } from "@/lib/subvenciones/match";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const now = new Date();
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const webhookUrl = (ws?.settings as any)?.subvenciones?.webhookUrl ?? "";
  const { profile: agencyProfile } = await getAgencyProfile(api.workspaceId);
  const [abiertas, total, ultima, convocatorias, clients] = await Promise.all([
    prisma.subvencionConvocatoria.count({ where: { abierta: true, OR: [{ fechaFin: null }, { fechaFin: { gte: now } }] } }),
    prisma.subvencionConvocatoria.count(),
    prisma.subvencionConvocatoria.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    prisma.subvencionConvocatoria.findMany({
      where: { abierta: true, OR: [{ fechaFin: null }, { fechaFin: { gte: now } }] },
      orderBy: { fechaFin: "asc" },
      take: 100,
      select: { id: true, titulo: true, organo: true, regiones: true, importeTotal: true, fechaFin: true, urlBases: true, fuente: true }
    }),
    prisma.client.findMany({ where: { workspaceId: api.workspaceId }, orderBy: { name: "asc" }, select: { id: true, name: true } })
  ]);
  return NextResponse.json({
    abiertas,
    total,
    ultimaActualizacion: ultima?.updatedAt ?? null,
    convocatorias,
    clients,
    webhookUrl,
    agencyProfile
  });
});

// Guarda el webhook de Make (avisos) y/o el perfil de la agencia (Negocio Vivo).
export const PATCH = withApi({ scope: "*" }, async (req, { api }) => {
  const parsed = z.object({
    webhookUrl: z.string().max(500).nullable().optional(),
    agencyProfile: z.string().max(4000).nullable().optional()
  }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings: any = ws?.settings ?? {};
  settings.subvenciones = settings.subvenciones ?? {};
  if (parsed.data.webhookUrl !== undefined) settings.subvenciones.webhookUrl = (parsed.data.webhookUrl ?? "").trim();
  if (parsed.data.agencyProfile !== undefined) settings.subvenciones.agencyProfile = (parsed.data.agencyProfile ?? "").trim();
  await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } });
  return NextResponse.json({ ok: true });
});
