import type { ProspectingProspect } from "@prisma/client";

export type ProspectCondition = {
  field?: "email" | "phone" | "linkedin" | "score" | "status" | "replied";
  operator?: "exists" | "missing" | "gte" | "equals";
  value?: string | number | boolean;
  onFalse?: "skip" | "stop";
};

type Scorable = Pick<ProspectingProspect, "email" | "phone" | "linkedinUrl" | "jobTitle" | "companyName" | "website" | "status" | "repliedAt">;

export function scoreProspect(prospect: Scorable) {
  const breakdown: Record<string, number> = {};
  if (prospect.email) breakdown.email = 18;
  if (prospect.phone) breakdown.phone = 12;
  if (prospect.linkedinUrl) breakdown.linkedin = 12;
  if (prospect.website) breakdown.website = 8;
  if (prospect.companyName) breakdown.company = 8;
  if (prospect.jobTitle) {
    breakdown.role = /owner|founder|ceo|director|head|manager|responsable|propietario/i.test(prospect.jobTitle) ? 22 : 8;
  }
  if (prospect.repliedAt || ["replied", "qualified", "meeting"].includes(prospect.status)) breakdown.engagement = 20;
  if (["qualified", "meeting"].includes(prospect.status)) breakdown.qualification = 15;
  return { score: Math.min(100, Object.values(breakdown).reduce((sum, value) => sum + value, 0)), breakdown };
}

export function prospectConditionMatches(condition: ProspectCondition | null | undefined, prospect: Scorable & { score?: number }) {
  if (!condition?.field) return true;
  const raw = condition.field === "linkedin" ? prospect.linkedinUrl : condition.field === "replied" ? Boolean(prospect.repliedAt) : prospect[condition.field as keyof typeof prospect];
  if (condition.operator === "missing") return !raw;
  if (condition.operator === "gte") return Number(raw || 0) >= Number(condition.value || 0);
  if (condition.operator === "equals") return String(raw ?? "") === String(condition.value ?? "");
  return Boolean(raw);
}

export function chooseProspectingVariant<T extends { body?: string; subject?: string }>(variants: T[] | null | undefined, prospectId: string): T | null {
  if (!variants?.length) return null;
  let hash = 0;
  for (const char of prospectId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return variants[hash % variants.length];
}

export function domainFromProspect(input: { website?: string | null; email?: string | null }) {
  try {
    if (input.website) return new URL(/^https?:\/\//i.test(input.website) ? input.website : `https://${input.website}`).hostname.replace(/^www\./, "");
  } catch {}
  return input.email?.split("@")[1]?.toLowerCase() || null;
}

export function summarizeProspectingSources(prospects:Array<{metadata:unknown;resolutionStatus?:string|null;total?:number;resolved?:number}>){
  const sources=new Map<string,{type:string;url:string|null;label:string;total:number;resolved:number;latest:string|null}>();
  for(const prospect of prospects){
    const metadata=(prospect.metadata||{}) as {source?:string;sourceUrl?:string;capturedAt?:string};const type=metadata.source||"manual";let url=metadata.sourceUrl||null;let label=type;
    if(url){try{const parsed=new URL(url);if(parsed.protocol!=="https:"||!["linkedin.com","www.linkedin.com","sales.linkedin.com"].includes(parsed.hostname.toLowerCase()))throw new Error("unsupported_source");parsed.username="";parsed.password="";parsed.hash="";parsed.searchParams.delete("page");parsed.searchParams.delete("start");url=parsed.toString();label=(parsed.searchParams.get("keywords")||parsed.searchParams.get("query")||type).replace(/\+/g," ").slice(0,160)}catch{url=null}}
    const key=`${type}:${url||"manual"}`;const current=sources.get(key)||{type,url,label,total:0,resolved:0,latest:null};current.total+=prospect.total??1;current.resolved+=prospect.resolved??(prospect.resolutionStatus==="resolved"?1:0);
    if(metadata.capturedAt&&(!current.latest||metadata.capturedAt>current.latest))current.latest=metadata.capturedAt;sources.set(key,current);
  }
  return [...sources.values()].sort((a,b)=>(b.latest||"").localeCompare(a.latest||""));
}
