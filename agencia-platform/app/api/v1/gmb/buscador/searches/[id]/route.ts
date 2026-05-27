/**
 * PATCH  /api/v1/gmb/buscador/searches/[id] → actualiza (p.ej. schedule)
 * DELETE /api/v1/gmb/buscador/searches/[id] → elimina (y sus resultados)
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  locations: z.string().min(1).max(4000).optional(),
  keyword: z.string().max(120).optional(),
  type: z.string().max(60).optional(),
  radiusKm: z.number().min(0.5).max(50).optional(),
  schedule: z.enum(["none", "daily", "weekly", "monthly"]).optional()
});

export const PATCH = withApi({ scope: "*" }, async (req, { params, api }) => {
  const s = await prisma.gmbSearch.findFirst({ where: { id: params.id, workspaceId: api.workspaceId }, select: { id: true } });
  if (!s) throw new ApiError(404, "not_found", "Búsqueda no encontrada");
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const search = await prisma.gmbSearch.update({ where: { id: params.id }, data: parsed.data });
  return NextResponse.json({ search });
});

export const DELETE = withApi({ scope: "*" }, async (_req, { params, api }) => {
  await prisma.gmbSearch.deleteMany({ where: { id: params.id, workspaceId: api.workspaceId } });
  return NextResponse.json({ ok: true });
});
