/**
 * POST /api/v1/leads/[id]/enrich-reviews
 *
 * Baja las reseñas del negocio desde Google Place Details y las guarda en el
 * lead (reviewsJson + % positivas/negativas). Habilita el placeholder
 * {{resena_negativa}} para citar una reseña real en el mensaje de captación.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { placeDetails } from "@/lib/leads/google-places";
import { pickNegativeReview } from "@/lib/leads/reviews";

export const POST = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const lead = await prisma.lead.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: { id: true, placeId: true }
  });
  if (!lead) throw new ApiError(404, "not_found", "Lead no encontrado");
  if (!lead.placeId) throw new ApiError(400, "no_place", "El lead no tiene placeId de Google");

  let details;
  try {
    details = await placeDetails({ workspaceId: api.workspaceId, placeId: lead.placeId });
  } catch (e: any) {
    throw new ApiError(502, "places_error", e?.message ?? "Error consultando Google Place Details");
  }

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      reviewsJson: details.reviews ?? [],
      positivePct: details.positivePct,
      negativePct: details.negativePct,
      neutralPct: details.neutralPct
    }
  });

  const negative = pickNegativeReview(details.reviews);
  return NextResponse.json({
    ok: true,
    reviewsCount: Array.isArray(details.reviews) ? details.reviews.length : 0,
    negativePct: details.negativePct,
    negative // {text, rating, when, author} | null → para previsualizar
  });
});
