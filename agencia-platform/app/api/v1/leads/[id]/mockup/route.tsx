/**
 * GET /api/v1/leads/[id]/mockup
 *
 * Imagen "antes/después" de la ficha de Google del negocio (PNG 1080x1080),
 * generada con next/og. Solo usuarios autenticados del workspace del lead.
 * La lógica de render vive en lib/leads/mockup para reutilizarla en el envío.
 */

import type { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { buildMockupImage } from "@/lib/leads/mockup";
import { getPlacePhotoDataUrl } from "@/lib/leads/google-places";

export const runtime = "nodejs";

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const lead = await prisma.lead.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: { name: true, category: true, province: true, rating: true, reviewsCount: true, rawData: true }
  });
  if (!lead) throw new ApiError(404, "not_found", "Lead no encontrado");

  const photoName = (lead.rawData as any)?.photos?.[0]?.name as string | undefined;
  const photoDataUrl = photoName
    ? await getPlacePhotoDataUrl({ workspaceId: api.workspaceId, photoName })
    : null;

  // withApi pasa el Response tal cual; ImageResponse es un Response válido.
  return buildMockupImage(lead, photoDataUrl) as unknown as NextResponse;
});
