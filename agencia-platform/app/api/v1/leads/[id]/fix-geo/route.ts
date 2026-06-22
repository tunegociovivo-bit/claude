/**
 * POST /api/v1/leads/[id]/fix-geo
 *
 * Re-geocodifica el lead desde su DIRECCIÓN (fuente de verdad) y corrige sus
 * coordenadas/provincia/ciudad cuando estaban mal (scrape con geo errónea).
 * Además recalcula el snapshot de ranking y re-renderiza el texto de sus
 * mensajes EN COLA, para que imagen y texto queden coherentes con la ubicación
 * corregida.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { geocodeAddress } from "@/lib/bubui/geocode";
import { getCompetitorRanking } from "@/lib/leads/competitors";
import { renderTemplate } from "@/lib/leads/template-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const POS_RE = /\{\{\s*(posicion|competidor_top|competidores_por_delante)\s*\}\}/;

export const POST = withApi({ scope: "*", rate: "admin" }, async (_req, { params, api }) => {
  const id = (params as any).id as string;
  const lead = await prisma.lead.findFirst({
    where: { id, workspaceId: api.workspaceId },
    select: { id: true, name: true, address: true, formattedAddress: true, province: true }
  });
  if (!lead) throw new ApiError(404, "not_found", "Lead no encontrado");

  const query = [lead.formattedAddress ?? lead.address, lead.province, "España"].filter(Boolean).join(", ");
  if (!lead.formattedAddress && !lead.address) {
    throw new ApiError(400, "no_address", "El lead no tiene dirección para geocodificar.");
  }
  const geo = await geocodeAddress(query);
  if (!geo) throw new ApiError(400, "geocode_failed", "No se pudo geocodificar la dirección (revisa la dirección o la API key de Google).");

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      latitude: geo.latitude,
      longitude: geo.longitude,
      ...(geo.province ? { province: geo.province } : {})
    }
  });

  // Recalcular snapshot + texto de los mensajes en cola de este lead.
  const updatedLead = await prisma.lead.findFirst({
    where: { id: lead.id },
    select: {
      id: true, placeId: true, name: true, category: true, types: true, province: true,
      formattedAddress: true, address: true, latitude: true, longitude: true, rating: true, reviewsCount: true
    }
  });
  let snapshot: any = null;
  try {
    snapshot = updatedLead ? await getCompetitorRanking(api.workspaceId, updatedLead as any, { store: false, harvest: false }) : null;
  } catch {
    snapshot = null;
  }

  const queued = await prisma.leadMessage.findMany({
    where: { workspaceId: api.workspaceId, leadId: lead.id, status: "queued", kind: { in: ["text", "ranking"] } },
    select: { id: true, kind: true, templateId: true }
  });
  let refreshed = 0;
  for (const m of queued) {
    // Cuerpo de origen: plantilla o paso actual de la secuencia activa.
    let sourceBody: string | null = null;
    if (m.templateId) {
      const tpl = await prisma.leadTemplate.findFirst({ where: { id: m.templateId, workspaceId: api.workspaceId }, select: { body: true } });
      sourceBody = tpl?.body ?? null;
    } else {
      const asg = await prisma.leadSequenceAssignment.findMany({
        where: { leadId: lead.id, status: "active", lead: { workspaceId: api.workspaceId } },
        include: { sequence: { include: { steps: { orderBy: { order: "asc" } } } } }
      });
      if (asg.length === 1) sourceBody = asg[0].sequence.steps[asg[0].currentStep]?.templateBody ?? null;
    }
    const needsRanking = m.kind === "ranking" || (sourceBody ? POS_RE.test(sourceBody) : false);
    try {
      const data: any = { rankingSnapshot: needsRanking ? (snapshot ?? undefined) : undefined };
      if (sourceBody) {
        const rendered = await renderTemplate({
          workspaceId: api.workspaceId,
          body: sourceBody,
          leadId: lead.id,
          ...(needsRanking ? { ranking: snapshot } : {})
        });
        if (!(m.kind === "text" && !rendered.trim())) data.renderedMessage = rendered;
      }
      await prisma.leadMessage.update({ where: { id: m.id }, data });
      refreshed++;
    } catch {
      /* no romper por un mensaje */
    }
  }

  return NextResponse.json({
    ok: true,
    latitude: geo.latitude,
    longitude: geo.longitude,
    province: geo.province ?? lead.province ?? null,
    city: geo.city ?? null,
    messagesRefreshed: refreshed
  });
});
