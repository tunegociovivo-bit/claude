/**
 * Configuración del Rank Grid por ficha. GET → config (o valores por defecto). POST → crea/actualiza
 * (centro/coords, radio, tamaño, proveedor, frecuencia). Tenant-scoped.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ensureGmbClient } from "@/lib/gmb/server";

export const dynamic = "force-dynamic";

const schema = z.object({
  centerLat: z.number().min(-90).max(90).nullable().optional(),
  centerLng: z.number().min(-180).max(180).nullable().optional(),
  radiusKm: z.number().min(0.5).max(20).optional(),
  gridSize: z.number().int().min(3).max(7).optional(),
  provider: z.string().max(40).optional(),
  frequency: z.enum(["manual", "weekly", "monthly"]).optional()
});

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const cfg = await prisma.gmbRankConfig.findFirst({ where: { workspaceId: api.workspaceId, clientId: client.id } });
  return NextResponse.json({
    ok: true,
    config: cfg ?? { centerLat: client.latitude ?? null, centerLng: client.longitude ?? null, radiusKm: 3, gridSize: 5, provider: "google_maps", frequency: "manual", isDefault: true }
  });
});

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const existing = await prisma.gmbRankConfig.findFirst({ where: { workspaceId: api.workspaceId, clientId: client.id } });
  const data = {
    centerLat: parsed.data.centerLat ?? existing?.centerLat ?? client.latitude ?? null,
    centerLng: parsed.data.centerLng ?? existing?.centerLng ?? client.longitude ?? null,
    radiusKm: parsed.data.radiusKm ?? existing?.radiusKm ?? 3,
    gridSize: parsed.data.gridSize ?? existing?.gridSize ?? 5,
    provider: parsed.data.provider ?? existing?.provider ?? "google_maps",
    frequency: parsed.data.frequency ?? existing?.frequency ?? "manual"
  };
  if (existing) {
    await prisma.gmbRankConfig.updateMany({ where: { id: existing.id, workspaceId: api.workspaceId }, data });
  } else {
    await prisma.gmbRankConfig.create({ data: { workspaceId: api.workspaceId, clientId: client.id, createdById: api.userId ?? null, ...data } });
  }
  return NextResponse.json({ ok: true, config: data });
});
