/**
 * PUT /api/v1/meta/campaigns/[id]/settings
 * Body: { attentionLevel?, toneFormality?, energyLevel?, styleHint? }
 *
 * Guarda las preferencias del user para el generador de imagen.
 * Se aplican en la PRÓXIMA generación (no reescriben las ya hechas).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";

const schema = z.object({
  attentionLevel: z.number().int().min(1).max(5).optional(),
  toneFormality: z.number().int().min(1).max(5).optional(),
  energyLevel: z.number().int().min(1).max(5).optional(),
  styleHint: z.enum(["editorial", "casual", "corporate", "playful", "luxurious"]).optional()
});

export const PUT = withApi({ scope: "*" }, async (req, { params, api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const campaign = await prisma.metaCampaign.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null }
  });
  if (!campaign) throw new ApiError(404, "not_found", "Campaña no encontrada");

  // Merge con lo que ya hubiera para no perder valores no enviados.
  const current = (campaign.generationSettings as any) ?? {};
  const merged = { ...current, ...parsed.data };

  await prisma.metaCampaign.update({
    where: { id: campaign.id },
    data: { generationSettings: merged as any }
  });
  return NextResponse.json({ ok: true, generationSettings: merged });
});
