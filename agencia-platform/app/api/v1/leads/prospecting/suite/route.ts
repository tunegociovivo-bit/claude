import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { apolloFindDecisionMakers, hunterCompanySearch, hunterDomainSearch, resolveContactKeys } from "@/lib/leads/enrich-contacts";
import { domainFromProspect, scoreProspect, summarizeProspectingSources } from "@/lib/leads/prospecting-intelligence";
import { markProspectingProspectReplied } from "@/lib/leads/prospecting-engine";
import { inboxMessageId, splitInboxMessageIds } from "@/lib/leads/prospecting-inbox";
import { buildProspectingConversion } from "@/lib/leads/prospecting-analytics";
import { scheduleResolvedProspect } from "@/lib/leads/prospecting-resolver";
import { normalizePhone } from "@/lib/leads/waha";
import { canAccessAdminPath, effectiveAdminAccess } from "@/lib/admin-catalog";
import { Prisma, type ProspectingProspect } from "@prisma/client";
import { createHash } from "node:crypto";

type ContactKeys={apolloKey:string|null;hunterKey:string|null};
type EnrichmentProspect=ProspectingProspect&{campaign:{status:string}};
const ANALYTICS_PAGE_SIZE=2000;
type WhatsappInboxAnalyticsRow=Prisma.LeadInboxMessageGetPayload<{select:{id:true;externalMessageId:true;leadId:true;phoneNormalized:true;fromPhone:true;body:true;receivedAt:true}}>;
type ProspectingWhatsappAnalyticsRow=Prisma.ProspectingMessageGetPayload<{select:{id:true;externalId:true;prospectId:true;body:true;createdAt:true}}>;
async function visitWhatsappInbox(where:Prisma.LeadInboxMessageWhereInput,visit:(row:WhatsappInboxAnalyticsRow)=>void){
  let cursor:string|undefined;
  do{const page=await prisma.leadInboxMessage.findMany({where,select:{id:true,externalMessageId:true,leadId:true,phoneNormalized:true,fromPhone:true,body:true,receivedAt:true},orderBy:{id:"asc"},take:ANALYTICS_PAGE_SIZE,...(cursor?{cursor:{id:cursor},skip:1}:{})});for(const row of page)visit(row);cursor=page.length===ANALYTICS_PAGE_SIZE?page.at(-1)?.id:undefined;}while(cursor);
}
async function visitProspectingWhatsapp(where:Prisma.ProspectingMessageWhereInput,visit:(row:ProspectingWhatsappAnalyticsRow)=>void){
  let cursor:string|undefined;
  do{const page=await prisma.prospectingMessage.findMany({where,select:{id:true,externalId:true,prospectId:true,body:true,createdAt:true},orderBy:{id:"asc"},take:ANALYTICS_PAGE_SIZE,...(cursor?{cursor:{id:cursor},skip:1}:{})});for(const row of page)visit(row);cursor=page.length===ANALYTICS_PAGE_SIZE?page.at(-1)?.id:undefined;}while(cursor);
}
const chunks=<T,>(items:T[],size=500)=>Array.from({length:Math.ceil(items.length/size)},(_,index)=>items.slice(index*size,(index+1)*size));
const compactKey=(value:string)=>createHash("sha256").update(value).digest("base64url").slice(0,16);
async function enrichOneProspect(prospect:EnrichmentProspect,keys:ContactKeys){
  const domain=prospect.companyDomain||domainFromProspect(prospect);
  const candidates:Array<{name?:string|null;title?:string|null;email?:string|null;linkedin?:string|null;confidence?:number|null;source:string}>=[];
  const calls:Promise<void>[]=[];
  if(domain&&keys.hunterKey)calls.push(hunterDomainSearch({domain,apiKey:keys.hunterKey,limit:10,throwOnError:true}).then(rows=>{candidates.push(...rows.map(p=>({name:p.name,title:p.position,email:p.email,confidence:p.confidence,source:"hunter"})))}));
  if(!domain&&prospect.companyName&&keys.hunterKey)calls.push(hunterCompanySearch({company:prospect.companyName,apiKey:keys.hunterKey,limit:10,throwOnError:true}).then(hit=>{candidates.push(...hit.people.map(p=>({name:p.name,title:p.position,email:p.email,confidence:p.confidence,source:"hunter_company"})))}));
  if(domain&&keys.apolloKey)calls.push(apolloFindDecisionMakers({domain,apiKey:keys.apolloKey,limit:10,throwOnError:true}).then(rows=>{candidates.push(...rows.map(p=>({name:p.name,title:p.title,email:p.email,linkedin:p.linkedin,source:"apollo"})))}));
  const providerResults=await Promise.allSettled(calls);const providerErrors=providerResults.flatMap(result=>result.status==="rejected"?[result.reason instanceof Error?result.reason.message:String(result.reason)]:[]);
  const normalize=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9 ]/g," ").split(/\s+/).filter(Boolean);
  const wanted=normalize([prospect.firstName,prospect.lastName].filter(Boolean).join(" "));
  const identity=wanted.length>=2?candidates.find(c=>{const actual=normalize(c.name||"");return wanted.every(token=>actual.includes(token))&&actual.every(token=>wanted.includes(token))}):undefined;
  const best=identity&&(identity.email||identity.linkedin)?identity:undefined;
  if(!best&&providerErrors.length)throw new Error(`Enriquecimiento incompleto; reintenta despu\u00e9s: ${providerErrors.join(" | ")}`);
  const updated={...prospect,email:prospect.email||best?.email||null,linkedinUrl:prospect.linkedinUrl||best?.linkedin||null,companyDomain:domain,jobTitle:prospect.jobTitle||identity?.title||null};const scored=scoreProspect(updated);
  const now=new Date();
  await prisma.prospectingProspect.update({where:{id:prospect.id},data:{email:updated.email,linkedinUrl:updated.linkedinUrl,companyDomain:domain,jobTitle:updated.jobTitle,resolutionStatus:best?"resolved":"not_found",resolutionConfidence:best?Math.max(85,best.confidence||0):0,resolutionError:best?null:"No se encontr\u00f3 una identidad con canal verificable",nextResolutionAt:null,enrichedAt:now,score:scored.score,scoreBreakdown:scored.breakdown,metadata:{...((prospect.metadata as object)||{}),enrichment:{candidates:candidates.slice(0,10),selectedSource:best?.source||null,providerErrors}}}});
  if(best)await scheduleResolvedProspect(prospect.id,prospect.workspaceId,now);
  return Boolean(best);
}

export const GET = withApi({ scope: "*", admin: true, rate: "admin" }, async (req, { api }) => {
  const campaignId = new URL(req.url).searchParams.get("campaignId") || undefined;
  const whereCampaign = campaignId ? { campaignId } : {};
  const [messages, activityStats, prospectingMessageStats, prospects, members, wonEvents] = await Promise.all([
    prisma.prospectingMessage.findMany({ where: { workspaceId: api.workspaceId, ...whereCampaign }, include: { prospect: true, campaign: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 250 }),
    prisma.prospectingActivity.groupBy({ by: ["channel", "status"], where: { workspaceId: api.workspaceId, ...whereCampaign }, _count: { _all: true } }),
    prisma.prospectingMessage.groupBy({ by: ["channel", "direction"], where: { workspaceId: api.workspaceId, ...whereCampaign }, _count: { _all: true } }),
    prisma.prospectingProspect.findMany({ where: { workspaceId: api.workspaceId, ...whereCampaign }, select: { id: true, campaignId: true, leadId: true, firstName: true, lastName: true, companyName: true, phone: true, status: true, score: true, attributedValueCents: true, assignedUserId: true, lastContactedAt: true, repliedAt: true, createdAt: true } }),
    prisma.membership.findMany({ where: { workspaceId: api.workspaceId }, include: { user: { select: { id: true, name: true, email: true, image: true } } }, orderBy: { joinedAt: "asc" } }),
    prisma.prospectingActivity.findMany({ where: { workspaceId: api.workspaceId, ...whereCampaign, channel: "crm", action: "attribution_won" }, distinct: ["prospectId"], select: { prospectId: true } })
  ]);
  const leadIds = prospects.flatMap(p => p.leadId ? [p.leadId] : []);
  const phones = prospects.flatMap(p => { const phone=normalizePhone(p.phone); return phone ? [phone] : []; });
  const whatsappMessages = leadIds.length || phones.length ? await prisma.leadInboxMessage.findMany({
    where: { workspaceId: api.workspaceId, OR: [...(leadIds.length ? [{ leadId: { in: leadIds } }] : []), ...(phones.length ? [{ phoneNormalized: { in: phones } }] : [])] },
    orderBy: { receivedAt: "desc" }, take: 250
  }) : [];
  const campaignNames = new Map((await prisma.prospectingCampaign.findMany({ where: { workspaceId: api.workspaceId, ...(campaignId ? { id: campaignId } : {}) }, select: { id: true, name: true } })).map(c => [c.id, c.name]));
  const prospectingNormalized = messages.map(message => ({ ...message, id: inboxMessageId("prospecting", message.id), source: "prospecting" as const }));
  const whatsappNormalized = whatsappMessages.flatMap(message => {
    const byLead = message.leadId ? prospects.find(p => p.leadId === message.leadId) : undefined;
    const messagePhone = normalizePhone(message.phoneNormalized || message.fromPhone);
    const phoneMatches = !byLead && messagePhone ? prospects.filter(p => normalizePhone(p.phone) === messagePhone) : [];
    const prospect = byLead || (phoneMatches.length === 1 ? phoneMatches[0] : undefined);
    return prospect ? [{ id: inboxMessageId("lead-inbox", message.id), externalId: message.externalMessageId, source: "lead-inbox" as const, channel: "whatsapp", direction: message.direction, body: message.body, read: message.read, createdAt: message.receivedAt, prospect, campaign: { name: campaignNames.get(prospect.campaignId) || "Prospección" } }] : [];
  });
  const seenMessages = new Set<string>();
  const allMessages = [...prospectingNormalized, ...whatsappNormalized].sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime()).filter(message => {
    const externalId = "externalId" in message ? message.externalId : null;
    const key = externalId ? `${message.channel}:external:${externalId}` : `${message.prospect.id}:${message.direction}:${new Date(message.createdAt).toISOString().slice(0,16)}:${message.body.trim()}`;
    if (seenMessages.has(key)) return false; seenMessages.add(key); return true;
  }).slice(0,250);
  const prospectByLead=new Map(prospects.filter(p=>p.leadId).map(p=>[p.leadId!,p]));
  const prospectsByPhone=new Map<string,typeof prospects>();
  for(const prospect of prospects){const phone=normalizePhone(prospect.phone);if(!phone)continue;const matches=prospectsByPhone.get(phone)||[];matches.push(prospect);prospectsByPhone.set(phone,matches);}
  const whatsappReplyKeys = new Set<string>();
  await visitProspectingWhatsapp({workspaceId:api.workspaceId,...whereCampaign,channel:"whatsapp",direction:"in"},message=>whatsappReplyKeys.add(compactKey(message.externalId?`external:${message.externalId}`:`${message.prospectId}:${message.createdAt.toISOString().slice(0,16)}:${message.body.trim()}`)));
  const addInboxReply=(message:WhatsappInboxAnalyticsRow)=>{
    const byLead=message.leadId?prospectByLead.get(message.leadId):undefined;
    const messagePhone=normalizePhone(message.phoneNormalized||message.fromPhone);const phoneMatches=!byLead&&messagePhone?prospectsByPhone.get(messagePhone)||[]:[];const prospect=byLead||(phoneMatches.length===1?phoneMatches[0]:undefined);
    if(prospect)whatsappReplyKeys.add(compactKey(message.externalMessageId?`external:${message.externalMessageId}`:`${prospect.id}:${message.receivedAt.toISOString().slice(0,16)}:${message.body.trim()}`));
  };
  for(const leadChunk of chunks(leadIds))await visitWhatsappInbox({workspaceId:api.workspaceId,direction:"in",leadId:{in:leadChunk}},addInboxReply);
  for(const phoneChunk of chunks(phones))await visitWhatsappInbox({workspaceId:api.workspaceId,direction:"in",phoneNormalized:{in:phoneChunk}},addInboxReply);
  const whatsappReplyCount=whatsappReplyKeys.size;
  const byChannel: Record<string, { actions: number; sent: number; replies: number }> = {};
  for (const item of activityStats) {
    const row = byChannel[item.channel] ||= { actions: 0, sent: 0, replies: 0 };
    row.actions += item._count._all;
    if (["sent", "completed"].includes(item.status)) row.sent += item._count._all;
  }
  for (const item of prospectingMessageStats) if (item.direction === "in" && item.channel !== "whatsapp") (byChannel[item.channel] ||= { actions: 0, sent: 0, replies: 0 }).replies += item._count._all;
  if (whatsappReplyCount) (byChannel.whatsapp ||= { actions: 0, sent: 0, replies: 0 }).replies += whatsappReplyCount;
  const funnel = ["pending", "active", "waiting_action", "replied", "qualified", "meeting", "completed"].map(status => ({ status, count: prospects.filter(p => p.status === status).length }));
  const conversion = buildProspectingConversion(prospects, wonEvents.flatMap(event => event.prospectId ? [event.prospectId] : []));
  const sourceRows=await prisma.$queryRaw<Array<{type:string;url:string|null;latest:string|null;total:number;resolved:number}>>(Prisma.sql`
    SELECT COALESCE("metadata"->>'source','manual') AS "type", "metadata"->>'sourceUrl' AS "url",
      MAX("metadata"->>'capturedAt') AS "latest", COUNT(*)::int AS "total",
      COUNT(*) FILTER (WHERE "resolutionStatus"='resolved')::int AS "resolved"
    FROM "ProspectingProspect"
    WHERE "workspaceId"=${api.workspaceId} ${campaignId?Prisma.sql`AND "campaignId"=${campaignId}`:Prisma.empty}
    GROUP BY COALESCE("metadata"->>'source','manual'), "metadata"->>'sourceUrl'
  `);
  const sources=summarizeProspectingSources(sourceRows.map(row=>({metadata:{source:row.type,sourceUrl:row.url||undefined,capturedAt:row.latest||undefined},total:Number(row.total),resolved:Number(row.resolved)})));
  const teamWorkload = [...prospects.reduce((counts, prospect) => {
    const id = prospect.assignedUserId || "unassigned";
    const current = counts.get(id) || { assigned: 0, active: 0 };
    current.assigned += 1;
    if (!["completed", "stopped", "excluded"].includes(prospect.status)) current.active += 1;
    counts.set(id, current);
    return counts;
  }, new Map<string, { assigned: number; active: number }>())].map(([userId, counts]) => ({ userId, ...counts }));
  const assignableMembers = members.filter(m => canAccessAdminPath(effectiveAdminAccess(m.role, m.adminGrants), "/admin/prospeccion"));
  return NextResponse.json({ messages: allMessages, members: assignableMembers.map(m => ({ membershipId: m.id, role: m.role, ...m.user })), teamWorkload, sources, analytics: { total: prospects.length, avgScore: prospects.length ? Math.round(prospects.reduce((n,p)=>n+p.score,0)/prospects.length) : 0, attributedValue: prospects.reduce((n,p)=>n+(p.attributedValueCents||0),0)/100, funnel, conversion, byChannel } });
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("score"), prospectIds: z.array(z.string()).min(1).max(500) }),
  z.object({ action: z.literal("enrich"), prospectIds: z.array(z.string()).min(1).max(50) }),
  z.object({ action: z.literal("assign"), prospectIds: z.array(z.string()).max(500).default([]), campaignId: z.string().optional(), userId: z.string().nullable() }),
  z.object({ action: z.literal("attribute"), prospectId: z.string(), valueCents: z.number().int().min(0).max(1_000_000_000), outcome: z.enum(["qualified", "meeting", "won", "lost"]) }),
  z.object({ action: z.literal("message"), prospectId: z.string(), channel: z.enum(["linkedin", "email", "whatsapp", "phone", "note"]), direction: z.enum(["in", "out"]).default("in"), body: z.string().trim().min(1).max(12000), externalId: z.string().optional() }),
  z.object({ action: z.literal("read"), messageIds: z.array(z.string()).min(1).max(500) })
]);

export const POST = withApi({ scope: "*", admin: true, rate: "admin" }, async (req, { api }) => {
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const data = parsed.data;
  if (data.action === "read") {
    const ids = splitInboxMessageIds(data.messageIds);
    if (!ids.prospecting.length && !ids.leadInbox.length) throw new ApiError(400, "validation_error", "No se han recibido mensajes válidos");
    const [prospectingResult, leadInboxResult] = await prisma.$transaction([
      prisma.prospectingMessage.updateMany({ where: { id: { in: ids.prospecting }, workspaceId: api.workspaceId }, data: { read: true } }),
      prisma.leadInboxMessage.updateMany({ where: { id: { in: ids.leadInbox }, workspaceId: api.workspaceId }, data: { read: true } })
    ]);
    return NextResponse.json({ updated: prospectingResult.count + leadInboxResult.count });
  }
  if (data.action === "message") {
    const prospect = await prisma.prospectingProspect.findFirst({ where: { id: data.prospectId, workspaceId: api.workspaceId } });
    if (!prospect) throw new ApiError(404, "not_found", "Prospecto no encontrado");
    if (data.direction === "in") await markProspectingProspectReplied(api.workspaceId, prospect.id);
    const messageData = { workspaceId: api.workspaceId, campaignId: prospect.campaignId, prospectId: prospect.id, channel: data.channel, direction: data.direction, body: data.body };
    const message = data.externalId
      ? await prisma.prospectingMessage.upsert({ where: { workspaceId_channel_externalId: { workspaceId: api.workspaceId, channel: data.channel, externalId: data.externalId } }, create: { ...messageData, externalId: data.externalId }, update: { body: data.body, status: "received" } })
      : await prisma.prospectingMessage.create({ data: messageData });
    return NextResponse.json({ message }, { status: 201 });
  }
  if (data.action === "attribute") {
    const prospect = await prisma.prospectingProspect.findFirst({ where: { id: data.prospectId, workspaceId: api.workspaceId } });
    if (!prospect) throw new ApiError(404, "not_found", "Prospecto no encontrado");
    const status = data.outcome === "won" ? "completed" : data.outcome === "lost" ? "stopped" : data.outcome;
    const updated = await prisma.prospectingProspect.update({ where: { id: prospect.id }, data: { status, attributedValueCents: data.valueCents, ...(data.outcome === "lost" ? { stopReason: "Oportunidad perdida" } : {}) } });
    await prisma.prospectingActivity.create({ data: { workspaceId: api.workspaceId, campaignId: prospect.campaignId, prospectId: prospect.id, channel: "crm", action: `attribution_${data.outcome}`, status: "completed", detail: `Valor atribuido: ${(data.valueCents/100).toFixed(2)} EUR`, executedAt: new Date() } });
    return NextResponse.json({ prospect: updated });
  }
  if (data.action === "assign") {
    if (!data.prospectIds.length && !data.campaignId) throw new ApiError(400, "validation_error", "Selecciona contactos o una campaña");
    if (data.userId) {
      const membership = await prisma.membership.findFirst({ where: { workspaceId: api.workspaceId, userId: data.userId } });
      if (!membership || !canAccessAdminPath(effectiveAdminAccess(membership.role, membership.adminGrants), "/admin/prospeccion")) throw new ApiError(400, "invalid_member", "El usuario no tiene acceso a NV Prospección");
    }
    const targetWhere = data.prospectIds.length ? { id: { in: data.prospectIds } } : { campaignId: data.campaignId! };
    const result = await prisma.prospectingProspect.updateMany({ where: { workspaceId: api.workspaceId, ...targetWhere }, data: { assignedUserId: data.userId } });
    if (data.userId && result.count) await prisma.notification.create({ data: { userId: data.userId, type: "prospecting_assignment", body: `Tienes ${result.count} prospecto${result.count === 1 ? "" : "s"} asignado${result.count === 1 ? "" : "s"} en NV Prospección.`, link: `/admin/prospeccion?campaign=${data.campaignId || ""}` } });
    return NextResponse.json({ updated: result.count });
  }
  const prospects = await prisma.prospectingProspect.findMany({ where: { id: { in: data.prospectIds }, workspaceId: api.workspaceId },include:{campaign:{select:{status:true}}} });
  if (data.action === "score") {
    await prisma.$transaction(prospects.map(p => { const result = scoreProspect(p); return prisma.prospectingProspect.update({ where: { id: p.id }, data: { score: result.score, scoreBreakdown: result.breakdown } }); }));
    return NextResponse.json({ updated: prospects.length });
  }
  const keys = await resolveContactKeys(api.workspaceId);
  let enriched=0,failed=0;
  for(let index=0;index<prospects.length;index+=3){
    const results=await Promise.allSettled(prospects.slice(index,index+3).map(prospect=>enrichOneProspect(prospect,keys)));
    for(const result of results){if(result.status==="fulfilled"&&result.value)enriched++;else if(result.status==="rejected")failed++;}
  }
  return NextResponse.json({ processed: prospects.length, enriched, failed, missingProviders: !keys.apolloKey && !keys.hunterKey });
});
