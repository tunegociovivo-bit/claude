import { prisma } from "@/lib/db/prisma";
import { apolloFindDecisionMakers, hunterCompanySearch, hunterDomainSearch, resolveContactKeys } from "@/lib/leads/enrich-contacts";
import { domainFromProspect, scoreProspect } from "@/lib/leads/prospecting-intelligence";

type Candidate={name:string;email?:string|null;linkedin?:string|null;title?:string|null;confidence?:number|null;source:string};
const tokens=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9 ]/g," ").split(/\s+/).filter(Boolean);
const retryAt=(attempt:number)=>new Date(Date.now()+Math.min(7*24,Math.pow(2,attempt)*6)*60*60*1000);
const leaseUntil=()=>new Date(Date.now()+15*60*1000);

export async function autoResolveProspectingProfiles(limit=20) {
  const now=new Date();
  const prospects=await prisma.prospectingProspect.findMany({
    where:{status:"pending_resolution",resolutionStatus:{in:["unresolved","retry_pending","not_configured","resolving"]},resolutionAttempts:{lt:4},OR:[{nextResolutionAt:null},{nextResolutionAt:{lte:now}}]},
    include:{campaign:{select:{status:true}}},orderBy:[{nextResolutionAt:"asc"},{createdAt:"asc"}],take:limit
  });
  const keyCache=new Map<string,ReturnType<typeof resolveContactKeys>>();
  let resolved=0,retrying=0;
  for(const prospect of prospects){
    const claimed=await prisma.prospectingProspect.updateMany({where:{id:prospect.id,status:"pending_resolution",resolutionStatus:prospect.resolutionStatus,resolutionAttempts:prospect.resolutionAttempts,nextResolutionAt:prospect.nextResolutionAt},data:{resolutionStatus:"resolving",nextResolutionAt:leaseUntil()}});
    if(!claimed.count)continue;
    const attempt=prospect.resolutionAttempts+1;
    try{
      let keyRequest=keyCache.get(prospect.workspaceId);if(!keyRequest){keyRequest=resolveContactKeys(prospect.workspaceId);keyCache.set(prospect.workspaceId,keyRequest)}const keys=await keyRequest;
      if(!keys.hunterKey&&!keys.apolloKey){await prisma.prospectingProspect.update({where:{id:prospect.id},data:{resolutionStatus:"not_configured",resolutionAttempts:attempt,nextResolutionAt:retryAt(attempt),resolutionError:"Apollo y Hunter no están configurados"}});retrying++;continue;}
      const domain=prospect.companyDomain||domainFromProspect(prospect);const candidates:Candidate[]=[];
      const providerCalls:Promise<Candidate[]>[]=[];
      if(domain&&keys.hunterKey)providerCalls.push(hunterDomainSearch({domain,apiKey:keys.hunterKey,limit:10,throwOnError:true}).then(rows=>rows.map(p=>({name:p.name,email:p.email,title:p.position,confidence:p.confidence,source:"hunter"}))));
      if(!domain&&prospect.companyName&&keys.hunterKey)providerCalls.push(hunterCompanySearch({company:prospect.companyName,apiKey:keys.hunterKey,limit:10,throwOnError:true}).then(hit=>hit.people.map(p=>({name:p.name,email:p.email,title:p.position,confidence:p.confidence,source:"hunter_company"}))));
      if(domain&&keys.apolloKey)providerCalls.push(apolloFindDecisionMakers({domain,apiKey:keys.apolloKey,limit:10,throwOnError:true}).then(rows=>rows.map(p=>({name:p.name,email:p.email,linkedin:p.linkedin,title:p.title,source:"apollo"}))));
      const providerResults=await Promise.allSettled(providerCalls);const providerErrors:string[]=[];
      for(const result of providerResults){if(result.status==="fulfilled")candidates.push(...result.value);else providerErrors.push(result.reason instanceof Error?result.reason.message:String(result.reason))}
      if(providerCalls.length&&providerErrors.length===providerCalls.length)throw new Error(`Todos los proveedores de enriquecimiento fallaron: ${providerErrors.join(" | ")}`);
      const wanted=tokens([prospect.firstName,prospect.lastName].filter(Boolean).join(" "));
      const identity=wanted.length>=2?candidates.find(c=>{const actual=tokens(c.name);return wanted.every(t=>actual.includes(t))&&actual.every(t=>wanted.includes(t))}):undefined;
      const match=identity&&(identity.email||identity.linkedin)?identity:undefined;
      if(!match&&providerErrors.length)throw new Error(`Enriquecimiento incompleto; se reintentar\u00e1: ${providerErrors.join(" | ")}`);
      const enriched={...prospect,email:prospect.email||match?.email||null,linkedinUrl:prospect.linkedinUrl||match?.linkedin||null,jobTitle:prospect.jobTitle||identity?.title||null};const scored=scoreProspect(enriched);
      const terminal=attempt>=4;
      await prisma.prospectingProspect.update({where:{id:prospect.id},data:{email:enriched.email,linkedinUrl:enriched.linkedinUrl,jobTitle:enriched.jobTitle,companyDomain:domain,enrichedAt:now,resolutionStatus:match?"resolved":terminal?"not_found":"retry_pending",resolutionConfidence:match?Math.max(85,match.confidence||0):0,resolutionAttempts:attempt,nextResolutionAt:match||terminal?null:retryAt(attempt),resolutionError:match?null:`No se encontró una identidad con canal verificable${providerErrors.length?`. Proveedores con error: ${providerErrors.join(" | ")}`:""}`,score:scored.score,scoreBreakdown:scored.breakdown,status:match?(prospect.campaign.status==="active"?"active":"pending"):"pending_resolution",nextActionAt:match&&prospect.campaign.status==="active"?now:null,metadata:{...((prospect.metadata as object)||{}),enrichment:{candidates:candidates.slice(0,10),selectedSource:match?.source||null,providerErrors}}}});
      if(match)resolved++;else if(!terminal)retrying++;
    }catch(error){await prisma.prospectingProspect.update({where:{id:prospect.id},data:{resolutionStatus:attempt>=4?"failed":"retry_pending",resolutionAttempts:attempt,nextResolutionAt:attempt>=4?null:retryAt(attempt),resolutionError:error instanceof Error?error.message:String(error)}}).catch(()=>null);if(attempt<4)retrying++;}
  }
  return {processed:prospects.length,resolved,retrying};
}
