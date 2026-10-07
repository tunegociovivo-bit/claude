/**
 * POST /api/v1/gmb/clients/[id]/create-scenario
 * Clona la plantilla de Make (settings.integrations.gmb.makeTemplateId) adaptada a la ficha
 * (cuenta/ubicación, conexión de Google de la ficha, webhook del Hub), la crea, la activa y
 * guarda su id. Requiere Make configurado en /admin/make-settings + los IDs en Ajustes GMB.
 */
import { publicBaseUrl } from "@/lib/public-url";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { createReviewsScenario } from "@/lib/gmb/make-reviews-scenario";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withApi({ scope: "admin", admin: true }, async (req, { params, api }) => {
  const client = await prisma.gmbClient.findFirst({ where: { id: params.id, workspaceId: api.workspaceId }, select: { id: true } });
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  try {
    const s = await createReviewsScenario(api.workspaceId, client.id, publicBaseUrl(req));
    return NextResponse.json({ ok: true, scenarioId: s.id, name: s.name });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    throw new ApiError(/Template|cuenta\/ubicación/.test(msg) ? 400 : 502, "make_error", msg.slice(0, 300));
  }
});
