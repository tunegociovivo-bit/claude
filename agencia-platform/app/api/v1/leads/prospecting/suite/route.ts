import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { apolloFindDecisionMakers, hunterCompanySearch, hunterDomainSearch, resolveContactKeys } from "@/lib/leads/enrich-contacts";
import { domainFromProspect, scoreProspect } from "@/lib/leads/prospecting-intelligence";
import { markProspectingProspectReplied } from "@/lib/leads/prospecting-engine";
import { normalizePhone } from "@/lib/leads/waha";
import { canAccessAdminPath, effectiveAdminAccess } from "@/lib/admin-catalog";

export const GET = withApi({ scope: "*", admin: true, rate: "admin" }, async (req, { api }) => {
  const campaignId = new URL(req.url).searchParams.get("campaignId") || undefined;
  const whereCampaign = campaignId ? { campaignId } : {};
  const [messages, activities, prospects, members] = await Promise.all([
    prisma.prospectingMessage.findMany({ where: { workspaceId: api.workspaceId, ...whereCampaign }, include: { prospect: true, campaign: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 250 }),
    prisma.prospectingActivity.findMany({ where: { workspaceId: api.workspaceId, ...whereCampaign }, select: { campaignId: true, channel: true, status: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 5000 }),
    prisma.prospectingProspect.findMany({ where: { workspaceId: api.workspaceId, ...whereCampaign }, select: { id: true, campaignId: true, leadId: true, firstName: true, lastName: true, companyName: true, phone: true, status: true, score: true, attributedValueCents: true, assignedUserId: true, createdAt: true } }),
    prisma.membership.findMany({ where: { workspaceId: api.workspaceId }, include: { user: { select: { id: true, name: true, email: true, image: true } } }, orderBy: { joinedAt: "asc" } })
  ]);
  const leadIds = prospects.flatMap(p => p.leadId ? [p.leadId] : []);
  const phones = prospects.flatMap(p => { const phone=normalizePhone(p.phone); return phone ? [phone] : []; });
  const whatsappMessages = leadIds.length || phones.length ? await prisma.leadInboxMessage.findMany({
    where: { workspaceId: api.workspaceId, OR: [...(leadIds.length ? [{ leadId: { in: leadIds } }] : []), ...(phones.length ? [{ phoneNormalized: { in: phones } }] : [])] },
    orderBy: { receivedAt: "desc" }, take: 250
  }) : [];
  const campaignNames = new Map((await prisma.prospectingCampaign.findMany({ where: { workspaceId: api.workspaceId, ...(campaignId ? { id: campaignId } : {}) }, select: { id: true, name: true } })).map(c => [c.id, c.name]));
  const whatsappNormalized = whatsappMessages.flatMap(message => {
    const byLead = message.leadId ? prospects.find(p => p.leadId === message.leadId) : undefined;
    const messagePhone = normalizePhone(message.phoneNormalized || message.fromPhone);
    const phoneMatches = !byLead && messagePhone ? prospects.filter(p => normalizePhone(p.phone) === messagePhone) : [];
    const prospect = byLead || (phoneMatches.length === 1 ? phoneMatches[0] : undefined);
    return prospect ? [{ id: `lead-inbox:${message.id}`, externalId: message.externalMessageId, channel: "whatsapp", direction: message.direction, body: message.body, read: message.read, createdAt: message.receivedAt, prospect, campaign: { name: campaignNames.get(prospect.campaignId) || "Prospección" } }] : [];
  });
  const seenMessages = new Set<string>();
  const allMessages = [...messages, ...whatsappNormalized].sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime()).filter(message => {
    const externalId = "externalId" in message ? message.externalId : null;
    const key = externalId ? `${message.channel}:external:${externalId}` : `${message.prospect.id}:${message.direction}:${new Date(message.createdAt).toISOString().slice(0,16)}:${message.body.trim()}`;
    if (seenMessages.has(key)) return false; seenMessages.add(key); return true;
  }).slice(0,250);
  const byChannel: Record<string, { actions: number; sent: number; replies: number }> = {};
  for (const item of activities) {
    const row = byChannel[item.channel] ||= { actions: 0, sent: 0, replies: 0 };
    row.actions++;
    if (["sent", "completed"].includes(item.status)) row.sent++;
  }
  for (const message of allMessages) if (message.direction === "in") (byChannel[message.channel] ||= { actions: 0, sent: 0, replies: 0 }).replies++;
  const funnel = ["pending", "active", "waiting_action", "replied", "qualified", "meeting", "completed"].map(status => ({ status, count: prospects.filter(p => p.status === status).length }));
  const assignableMembers = members.filter(m => canAccessAdminPath(effectiveAdminAccess(m.role, m.adminGrants), "/admin/prospeccion"));
  return NextResponse.json({ messages: allMessages, members: assignableMembers.map(m => ({ membershipId: m.id, role: m.role, ...m.user })), analytics: { total: prospects.length, avgScore: prospects.length ? Math.round(prospects.reduce((n,p)=>n+p.score,0)/prospects.length) : 0, attributedValue: prospects.reduce((n,p)=>n+(p.attributedValueCents||0),0)/100, funnel, byChannel } });
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("score"), prospectIds: z.array(z.string()).min(1).max(500) }),
  z.object({ action: z.literal("enrich"), prospectIds: z.array(z.string()).min(1).max(50) }),
  z.object({ action: z.literal("assign"), prospectIds: z.array(z.string()).min(1).max(500), userId: z.string().nullable() }),
  z.object({ action: z.literal("attribute"), prospectId: z.string(), valueCents: z.number().int().min(0).max(1_000_000_000), outcome: z.enum(["qualified", "meeting", "won", "lost"]) }),
  z.object({ action: z.literal("message"), prospectId: z.string(), channel: z.enum(["linkedin", "email", "whatsapp", "phone", "note"]), direction: z.enum(["in", "out"]).default("in"), body: z.string().trim().min(1).max(12000), externalId: z.string().optional() }),
  z.object({ action: z.literal("read"), messageIds: z.array(z.string()).min(1).max(500) })
]);

export const POST = withApi({ scope: "*", admin: true, rate: "admin" }, async (req, { api }) => {
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const data = parsed.data;
  if (data.action === "read") {
    const result = await prisma.prospectingMessage.updateMany({ where: { id: { in: data.messageIds }, workspaceId: api.workspaceId }, data: { read: true } });
    return NextResponse.json({ updated: result.count });
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
  const prospects = await prisma.prospectingProspect.findMany({ where: { id: { in: data.prospectIds }, workspaceId: api.workspaceId } });
  if (data.action === "assign") {
    if (data.userId) {
      const membership = await prisma.membership.findFirst({ where: { workspaceId: api.workspaceId, userId: data.userId } });
      if (!membership || !canAccessAdminPath(effectiveAdminAccess(membership.role, membership.adminGrants), "/admin/prospeccion")) throw new ApiError(400, "invalid_member", "El usuario no tiene acceso a NV Prospección");
    }
    const result = await prisma.prospectingProspect.updateMany({ where: { id: { in: prospects.map(p=>p.id) } }, data: { assignedUserId: data.userId } });
    if (data.userId && result.count) await prisma.notification.create({ data: { userId: data.userId, type: "prospecting_assignment", body: `Tienes ${result.count} prospecto${result.count === 1 ? "" : "s"} asignado${result.count === 1 ? "" : "s"} en NV Prospección.`, link: `/admin/prospeccion?campaign=${prospects[0]?.campaignId || ""}` } });
    return NextResponse.json({ updated: result.count });
  }
  if (data.action === "score") {
    await prisma.$transaction(prospects.map(p => { const result = scoreProspect(p); return prisma.prospectingProspect.update({ where: { id: p.id }, data: { score: result.score, scoreBreakdown: result.breakdown } }); }));
    return NextResponse.json({ updated: prospects.length });
  }
  const keys = await resolveContactKeys(api.workspaceId);
  let enriched = 0;
  for (const prospect of prospects) {
    const domain = prospect.companyDomain || domainFromProspect(prospect);
    let candidates: Array<{ name?: string | null; title?: string | null; email?: string | null; linkedin?: string | null; confidence?: number | null; source: string }> = [];
    if (domain && keys.hunterKey) candidates.push(...(await hunterDomainSearch({ domain, apiKey: keys.hunterKey, limit: 10 })).map(p => ({ name:p.name,title:p.position,email:p.email,confidence:p.confidence,source:"hunter" })));
    if (!domain && prospect.companyName && keys.hunterKey) { const hit = await hunterCompanySearch({ company: prospect.companyName, apiKey: keys.hunterKey, limit: 10 }); candidates.push(...hit.people.map(p=>({name:p.name,title:p.position,email:p.email,confidence:p.confidence,source:"hunter_company"}))); }
    if (domain && keys.apolloKey) candidates.push(...(await apolloFindDecisionMakers({ domain, apiKey: keys.apolloKey, limit: 10 })).map(p=>({name:p.name,title:p.title,email:p.email,linkedin:p.linkedin,source:"apollo"})));
    const normalizeName = (value:string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
    const wanted = normalizeName([prospect.firstName, prospect.lastName].filter(Boolean).join(" "));
    const sameName = wanted.length >= 2 ? candidates.find(c => { const actual=normalizeName(c.name||""); return wanted.every(token=>actual.includes(token)) && actual.every(token=>wanted.includes(token)); }) : undefined;
    const best = sameName && (sameName.email || sameName.linkedin) ? sameName : undefined;
    const confidence = best ? Math.max(85,best.confidence||0) : 0;
    const updated = { ...prospect, email: prospect.email || best?.email || null, linkedinUrl: prospect.linkedinUrl || best?.linkedin || null, companyDomain: domain, jobTitle: prospect.jobTitle || best?.title || null };
    const scored = scoreProspect(updated);
    await prisma.prospectingProspect.update({ where: { id: prospect.id }, data: { email: updated.email, linkedinUrl: updated.linkedinUrl, companyDomain: domain, jobTitle: updated.jobTitle, resolutionStatus: best ? "resolved" : "not_found", resolutionConfidence: confidence, enrichedAt: new Date(), score: scored.score, scoreBreakdown: scored.breakdown, metadata: { ...((prospect.metadata as object)||{}), enrichment: { candidates: candidates.slice(0,10), selectedSource: best?.source || null } } } });
    if (best) enriched++;
  }
  return NextResponse.json({ processed: prospects.length, enriched, missingProviders: !keys.apolloKey && !keys.hunterKey });
});
