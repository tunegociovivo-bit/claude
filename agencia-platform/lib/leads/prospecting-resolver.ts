import { prisma } from "@/lib/db/prisma";
import { apolloFindDecisionMakers, hunterCompanySearch, hunterDomainSearch, resolveContactKeys } from "@/lib/leads/enrich-contacts";
import { domainFromProspect, scoreProspect } from "@/lib/leads/prospecting-intelligence";

function nameTokens(value:string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean); }

export async function autoResolveProspectingProfiles(limit=5) {
  const prospects = await prisma.prospectingProspect.findMany({ where: { resolutionStatus: "unresolved", status: "pending_resolution" }, include: { campaign: { select: { status: true } } }, orderBy: { createdAt: "asc" }, take: limit });
  let resolved=0;
  for (const prospect of prospects) {
    try {
      const keys=await resolveContactKeys(prospect.workspaceId); const domain=prospect.companyDomain||domainFromProspect(prospect);
      const candidates:Array<{name:string;email?:string|null;linkedin?:string|null;title?:string|null;confidence?:number|null;source:string}>=[];
      if(domain&&keys.hunterKey)candidates.push(...(await hunterDomainSearch({domain,apiKey:keys.hunterKey,limit:10})).map(p=>({name:p.name,email:p.email,title:p.position,confidence:p.confidence,source:'hunter'})));
      if(!domain&&prospect.companyName&&keys.hunterKey){const x=await hunterCompanySearch({company:prospect.companyName,apiKey:keys.hunterKey,limit:10});candidates.push(...x.people.map(p=>({name:p.name,email:p.email,title:p.position,confidence:p.confidence,source:'hunter_company'})))}
      if(domain&&keys.apolloKey)candidates.push(...(await apolloFindDecisionMakers({domain,apiKey:keys.apolloKey,limit:10})).map(p=>({name:p.name,email:p.email,linkedin:p.linkedin,title:p.title,source:'apollo'})));
      const wanted=nameTokens([prospect.firstName,prospect.lastName].filter(Boolean).join(' ')); const identityMatch=wanted.length>=2?candidates.find(c=>{const actual=nameTokens(c.name);return wanted.every(t=>actual.includes(t))&&actual.every(t=>wanted.includes(t))}):undefined; const match=identityMatch&&(identityMatch.email||identityMatch.linkedin)?identityMatch:undefined;
      const enriched={...prospect,email:prospect.email||match?.email||null,linkedinUrl:prospect.linkedinUrl||match?.linkedin||null,jobTitle:prospect.jobTitle||identityMatch?.title||null,website:prospect.website}; const scored=scoreProspect(enriched);
      await prisma.prospectingProspect.update({where:{id:prospect.id},data:{email:enriched.email,linkedinUrl:enriched.linkedinUrl,jobTitle:enriched.jobTitle,companyDomain:domain,enrichedAt:new Date(),resolutionStatus:match?'resolved':'not_found',resolutionConfidence:match?Math.max(85,match.confidence||0):0,score:scored.score,scoreBreakdown:scored.breakdown,status:match?(prospect.campaign.status==='active'?'active':'pending'):'pending_resolution',nextActionAt:match&&prospect.campaign.status==='active'?new Date():null,metadata:{...((prospect.metadata as object)||{}),enrichment:{candidates:candidates.slice(0,10),selectedSource:match?.source||null}}}}); if(match)resolved++;
    } catch { /* Un proveedor no debe detener los demás perfiles. */ }
  }
  return {processed:prospects.length,resolved};
}
