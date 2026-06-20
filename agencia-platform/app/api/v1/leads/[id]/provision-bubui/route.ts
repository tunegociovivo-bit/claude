/**
 * POST /api/v1/leads/[id]/provision-bubui
 *
 * Crea (o refresca) la ficha de Bubui del lead en estado PENDIENTE y devuelve
 * el enlace mágico de activación (bubui.app/negocios?claim=<token>) para
 * enviárselo por WhatsApp. No envía nada: la UI lo copia o lo encola.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { provisionBubuiFromLead } from "@/lib/bubui/provision";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*", rate: "admin" }, async (_req, { api, params }) => {
  const id = (params as any)?.id as string;
  if (!id) throw new ApiError(400, "missing_id", "Falta id");

  const lead = await prisma.lead.findFirst({
    where: { id, workspaceId: api.workspaceId },
    select: {
      id: true, name: true, category: true, province: true,
      formattedAddress: true, address: true, latitude: true, longitude: true,
      phone: true, placeId: true
    }
  });
  if (!lead) throw new ApiError(404, "not_found", "Lead no encontrado");
  if (!lead.name?.trim()) throw new ApiError(400, "no_name", "El lead no tiene nombre");

  const result = await provisionBubuiFromLead(lead);
  return NextResponse.json({ ok: true, ...result });
});
