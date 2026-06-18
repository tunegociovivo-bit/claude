/**
 * GET /api/v1/leads/[id]/mockup
 *
 * Imagen "antes/después" de la ficha de Google del negocio (PNG 1080x1080),
 * generada con next/og. Solo usuarios autenticados del workspace del lead.
 * La lógica de render vive en lib/leads/mockup para reutilizarla en el envío.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { renderMockupPng } from "@/lib/leads/mockup";
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

  // IMPORTANTE: renderizamos a Buffer DENTRO del handler. Si devolviéramos el
  // ImageResponse directamente, el render ocurre durante el streaming (fuera del
  // try de withApi) y cualquier fallo tumba el worker → 502 imposible de
  // diagnosticar. Al bufferizar aquí, un error se captura y se devuelve como
  // JSON legible.
  let png: Buffer;
  try {
    png = await renderMockupPng(lead, photoDataUrl);
  } catch (e: any) {
    throw new ApiError(500, "mockup_render_error", `No se pudo generar el mockup: ${e?.message ?? e}`);
  }

  return new NextResponse(new Uint8Array(png), {
    status: 200,
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" }
  });
});
