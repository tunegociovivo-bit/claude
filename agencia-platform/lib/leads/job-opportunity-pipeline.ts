import { prisma } from "@/lib/db/prisma";
import { startJobsOutreach, upsertLead } from "@/lib/leads/search-manager";
import { enrichJobsResults } from "@/lib/leads/sources";
import { offersToLeadResults, type RawOffer } from "@/lib/leads/sources/jobs";

export async function ingestLinkedInJobOpportunity(workspaceId: string, offer: RawOffer) {
  const mapped = offersToLeadResults([{ ...offer, board: "linkedin" }]);
  if (!mapped.length) {
    return { accepted: false as const, reason: "La oferta no corresponde a un puesto de marketing o inteligencia artificial" };
  }
  const [enriched] = await enrichJobsResults(workspaceId, mapped);
  if (!enriched) return { accepted: false as const, reason: "No se pudo normalizar la oferta" };

  let search = await prisma.leadSearch.findFirst({
    where: { workspaceId, source: "jobs", location: "LinkedIn · NV Prospección" } as any
  });
  if (!search) {
    search = await prisma.leadSearch.create({
      data: {
        workspaceId,
        keyword: "Ofertas capturadas en LinkedIn",
        location: "LinkedIn · NV Prospección",
        scope: "custom",
        source: "jobs",
        totalProvinces: 1,
        processedProvinces: 1,
        totalResults: 0,
        status: "COMPLETED",
        sourceConfig: { linkedinProspectingBridge: true }
      } as any
    });
  }

  const existing = await prisma.lead.findUnique({
    where: { workspaceId_placeId: { workspaceId, placeId: enriched.placeId } },
    select: { id: true }
  });
  await upsertLead({
    workspaceId,
    searchId: search.id,
    province: enriched.province || offer.location || "España",
    position: 1,
    r: enriched,
    aiRelevance: null,
    skipExisting: false,
    multiLocation: false
  });
  const lead = await prisma.lead.findUnique({
    where: { workspaceId_placeId: { workspaceId, placeId: enriched.placeId } },
    select: { id: true, email: true }
  });
  if (!lead) throw new Error("La oferta se normalizó pero no se pudo guardar como lead");

  await startJobsOutreach(workspaceId, search.id);
  const linked = await prisma.prospectingProspect.findFirst({
    where: { workspaceId, leadId: lead.id },
    select: { id: true }
  });
  if (!existing) {
    await prisma.leadSearch.update({ where: { id: search.id }, data: { totalResults: { increment: 1 } } }).catch(() => null);
  }
  return {
    accepted: true as const,
    created: !existing,
    leadId: lead.id,
    emailFound: Boolean(lead.email),
    linkedinDrafted: Boolean(linked)
  };
}
