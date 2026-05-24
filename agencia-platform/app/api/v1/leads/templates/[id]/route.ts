/**
 * PATCH  /api/v1/leads/templates/[id]  → editar plantilla
 * DELETE /api/v1/leads/templates/[id]  → borrar plantilla
 *
 * Ambas operan solo sobre plantillas del workspace del llamante.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  body: z.string().min(1).max(4000).optional(),
  channel: z.enum(["whatsapp", "email", "sms"]).optional(),
  isDefault: z.boolean().optional()
});

export const PATCH = withApi({ scope: "*" }, async (req, { params, api }) => {
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const existing = await prisma.leadTemplate.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: { id: true }
  });
  if (!existing) throw new ApiError(404, "not_found", "Plantilla no encontrada");

  const updated = await prisma.leadTemplate.update({
    where: { id: existing.id },
    data: parsed.data
  });
  return NextResponse.json(updated);
});

export const DELETE = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const res = await prisma.leadTemplate.deleteMany({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  if (res.count === 0) throw new ApiError(404, "not_found", "Plantilla no encontrada");
  return NextResponse.json({ ok: true });
});
