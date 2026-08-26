import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { findMarketingEmailsByDomain } from "@/lib/leads/enrich-contacts";
import { rankFranchiseDecisionMakers } from "@/lib/leads/franchise-decision-maker";
import { researchCorporateWebsite, researchPublicWeb } from "@/lib/leads/franchise-public-contact-research";
import { researchAefBrand } from "@/lib/leads/sources/franchise-directory";

export const dynamic = "force-dynamic";

const schema = z.object({ id: z.string().min(1) });

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const lead = await prisma.lead.findFirst({
    where: { id: parsed.data.id, workspaceId: api.workspaceId, contactStatus: { not: "excluded" } },
    select: { id: true, name: true, website: true, rawData: true }
  });
  if (!lead) throw new ApiError(404, "not_found", "Cuenta de franquicia no encontrada");
  const raw: any = lead.rawData ?? {};
  const brand = raw.brand ?? lead.name;
  const domain = String(lead.website ?? raw.website ?? "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  const aefContact = await researchAefBrand(api.workspaceId, brand).catch(() => null);
  const aefCandidates = aefContact?.emails?.length
    ? aefContact.emails.map((email) => ({
        email,
        name: aefContact.contactName || "Departamento de franquicias",
        role: aefContact.role || "Contacto de franquicias publicado por AEF",
        source: "aef_directory",
        providerConfidence: 85,
        evidenceUrl: aefContact.sourceUrl
      }))
    : [];
  const relatedDomains = [...new Set([
    ...(domain ? [domain] : []),
    ...aefCandidates.map((candidate) => candidate.email.split("@")[1]).filter(Boolean),
    ...(aefContact?.corporateWeb ? [String(aefContact.corporateWeb).replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]] : [])
  ])].filter((value) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)).slice(0, 3);
  const relatedCompany = aefCandidates[0]?.email.split("@")[1]?.split(".")[0] || brand;
  const perDomainResults = await Promise.all(relatedDomains.map(async (relatedDomain) => {
    const [providers, website, publicWeb] = await Promise.all([
      findMarketingEmailsByDomain(api.workspaceId, relatedDomain, 20, relatedCompany).catch(() => []),
      researchCorporateWebsite(api.workspaceId, relatedCompany, `https://${relatedDomain}`).catch(() => []),
      researchPublicWeb(api.workspaceId, `${brand} ${relatedCompany}`, relatedDomain).catch(() => [])
    ]);
    return { providers, website, publicWeb };
  }));
  const providerCandidates = perDomainResults.flatMap((result) => result.providers);
  const websiteCandidates = perDomainResults.flatMap((result) => result.website);
  const publicWebCandidates = perDomainResults.length
    ? perDomainResults.flatMap((result) => result.publicWeb)
    : await researchPublicWeb(api.workspaceId, brand, "dominio corporativo pendiente").catch(() => []);
  const candidates = [...aefCandidates, ...providerCandidates, ...websiteCandidates, ...publicWebCandidates]
    .filter((candidate, index, list) => list.findIndex((item) => item.email.toLowerCase() === candidate.email.toLowerCase()) === index);
  const ranked = rankFranchiseDecisionMakers(candidates, domain || relatedDomains[0] || "");
  const selected = ranked.find((candidate) => candidate.sendAllowed) ?? null;
  const copies = selected ? ranked.filter((candidate) => candidate.email !== selected.email && candidate.copyAllowed).slice(0, 4) : [];
  const now = new Date().toISOString();
  const research = {
    status: selected ? "verified" : "pending",
    selected,
    copies,
    candidates: ranked.slice(0, 20),
    sources: {
      apolloHunter: providerCandidates.length,
      aef: aefCandidates.length,
      corporateWebsite: websiteCandidates.length,
      publicWeb: publicWebCandidates.length,
      relatedDomains
    },
    researchedAt: now
  };
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      email: selected?.email ?? null,
      rawData: {
        ...raw,
        email: selected?.email ?? undefined,
        directorName: selected?.name ?? undefined,
        directorRole: selected?.role ?? undefined,
        linkedin: selected?.linkedin ?? undefined,
        decisionMakerResearch: research
      }
    }
  });
  return NextResponse.json({ ok: true, research });
});
