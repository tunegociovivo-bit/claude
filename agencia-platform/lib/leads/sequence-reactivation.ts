/**
 * Reactivar una secuencia de seguimiento para un nicho (palabra clave de
 * búsqueda): los leads que recibieron el primer mensaje y no han cerrado
 * conversación reciben los pasos siguientes de la secuencia.
 *
 * Quedan fuera, entre otros:
 *  - los bloqueados / no interesados (baja, exclusión, «no me interesa»);
 *  - los que escribieron y a los que alguien del equipo ya contestó
 *    (conversación en marcha con el comercial) o derivados al comercial;
 *  - por defecto, los que escribieron algo real y aún nadie les contestó
 *    (necesitan una respuesta humana, no un recordatorio automático).
 * Las autorrespuestas de WhatsApp Business no cuentan como respuesta.
 */
import { prisma } from "@/lib/db/prisma";
import { SENT_STATUSES } from "./send-queue";
import { normalizePhone } from "./waha";
import { suppressionHash } from "./suppressions";
import { isEmailOnlyLead } from "./email-only";
import { stepDelayMs, uniqueSequenceSteps } from "./sequences";

// Fuentes que no son nichos de captación por WhatsApp.
const NON_NICHE_SOURCES = new Set(["jobs", "franchises", "trade_fair_exhibitors", "linkedin"]);
const BLOCKING_CLASSIFICATIONS = new Set(["opt_out", "positive_no"]);
const SENT = new Set(SENT_STATUSES);

export function nicheKey(keyword: string | null | undefined): string {
  return String(keyword ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const REACTIVATION_REASONS = {
  blocked: "Bloqueados o no interesados",
  client: "Ya son clientes",
  conversation: "Conversación en marcha con el comercial",
  unanswered: "Escribieron y aún nadie les ha contestado",
  emailOnly: "Origen solo email",
  noPhone: "Sin teléfono",
  neverContacted: "Aún no recibieron el primer mensaje",
  inCadence: "Con la cadencia automática en marcha",
  inSequence: "Ya están en una secuencia activa",
  pending: "Tienen un mensaje en cola",
  recent: "Contactados hace muy poco",
  alreadyDone: "Ya recibieron estos pasos"
} as const;
export type ReactivationReason = keyof typeof REACTIVATION_REASONS;

export type ReactivationLeadFacts = {
  contactStatus: string;
  isClient: boolean;
  handedToCommercial: boolean;
  emailOnly: boolean;
  hasPhone: boolean;
  blocked: boolean;
  /** Primera respuesta real (no autorrespuesta) del lead. */
  firstGenuineInboundAt: Date | null;
  /** Alguien del equipo escribió después de esa respuesta. */
  humanReplyAfterInbound: boolean;
  conversationStatus: string | null;
  lastSentAt: Date | null;
  hasPendingMessage: boolean;
  inActiveCadence: boolean;
  inOtherActiveSequence: boolean;
  thisSequence: { status: string; currentStep: number } | null;
};

export type ReactivationOptions = {
  fromIndex: number; // índice (0-based) del primer paso a enviar
  stepCount: number;
  minDaysSinceContact: number;
  includeUnanswered: boolean;
  now: Date;
};

/** ¿Entra este lead en la reactivación? Devuelve el primer motivo de exclusión. */
export function classifyReactivationLead(facts: ReactivationLeadFacts, opts: ReactivationOptions): { eligible: true } | { eligible: false; reason: ReactivationReason } {
  const no = (reason: ReactivationReason) => ({ eligible: false as const, reason });
  if (facts.blocked || ["excluded", "discarded"].includes(facts.contactStatus) || facts.conversationStatus === "not_interested") return no("blocked");
  if (facts.isClient || facts.contactStatus === "client") return no("client");
  if (facts.emailOnly) return no("emailOnly");
  if (facts.handedToCommercial || ["followup", "resolved"].includes(facts.conversationStatus ?? "")) return no("conversation");
  const replied = Boolean(facts.firstGenuineInboundAt) || facts.contactStatus === "responded";
  if (replied && facts.humanReplyAfterInbound) return no("conversation");
  if (replied && !opts.includeUnanswered) return no("unanswered");
  if (!facts.hasPhone) return no("noPhone");
  if (!facts.lastSentAt) return no("neverContacted");
  if (facts.inActiveCadence) return no("inCadence");
  if (facts.thisSequence?.status === "active" || facts.inOtherActiveSequence) return no("inSequence");
  if (facts.hasPendingMessage) return no("pending");
  // Ya se le encoló (en esta secuencia) el paso desde el que se quiere reactivar.
  if (facts.thisSequence && facts.thisSequence.currentStep >= opts.fromIndex) return no("alreadyDone");
  if (opts.now.getTime() - facts.lastSentAt.getTime() < opts.minDaysSinceContact * 86_400_000) return no("recent");
  return { eligible: true };
}

type OutboundLike = { meta: unknown; externalMessageId: string | null; body: string };

const normalizeBody = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * ¿Lo escribió una persona del equipo? Se descartan los envíos automáticos
 * (cola de captación, autorrespuesta, auto-seguimiento IA, difusiones). En la
 * duda cuenta como humano: es el lado seguro para no enviar un recordatorio
 * en mitad de una conversación.
 */
export function isHumanOutbound(message: OutboundLike, automated: { externalIds: Set<string>; bodies: Set<string>; patterns?: RegExp[] }): boolean {
  const meta = (message.meta && typeof message.meta === "object" ? message.meta : {}) as Record<string, unknown>;
  if (meta.source === "human_reply") return true;
  if (meta.autoFollowup) return false;
  if (message.externalMessageId && automated.externalIds.has(message.externalMessageId)) return false;
  const body = normalizeBody(message.body);
  if (body && automated.bodies.has(body)) return false;
  if (body && automated.patterns?.some((pattern) => pattern.test(body))) return false;
  return true;
}

/** Plantilla con {{nombre}} → patrón que reconoce el texto ya personalizado. */
export function templatePattern(template: string): RegExp | null {
  const normalized = normalizeBody(template);
  if (!normalized) return null;
  const parts = normalized.split(/\{\{\s*[a-z_]+\s*\}\}/i).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${parts.join(".*")}$`, "i");
}

function chunk<T>(items: T[], size = 4000): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function inChunks<T, R>(items: T[], fn: (part: T[]) => Promise<R[]>): Promise<R[]> {
  const out: R[] = [];
  for (const part of chunk(items)) if (part.length) out.push(...(await fn(part)));
  return out;
}

export type SequenceNiche = { key: string; keyword: string; searchIds: string[]; leads: number; contacted: number; responded: number; lastSearchAt: Date };

/** Nichos (palabras clave de búsqueda) con sus leads. */
export async function listSequenceNiches(workspaceId: string): Promise<SequenceNiche[]> {
  const searches = await prisma.leadSearch.findMany({
    where: { workspaceId },
    select: { id: true, keyword: true, source: true, createdAt: true },
    orderBy: { createdAt: "desc" }
  });
  const usable = searches.filter((search) => !NON_NICHE_SOURCES.has(search.source) && nicheKey(search.keyword));
  const counts = usable.length
    ? await prisma.lead.groupBy({ by: ["searchId", "contactStatus"], where: { workspaceId, searchId: { in: usable.map((search) => search.id) } }, _count: { _all: true } })
    : [];
  const niches = new Map<string, SequenceNiche>();
  for (const search of usable) {
    const key = nicheKey(search.keyword);
    const niche = niches.get(key) ?? { key, keyword: search.keyword.trim(), searchIds: [], leads: 0, contacted: 0, responded: 0, lastSearchAt: search.createdAt };
    niche.searchIds.push(search.id);
    if (search.createdAt > niche.lastSearchAt) niche.lastSearchAt = search.createdAt;
    niches.set(key, niche);
  }
  const byId = new Map(usable.map((search) => [search.id, nicheKey(search.keyword)]));
  for (const row of counts) {
    const niche = row.searchId ? niches.get(byId.get(row.searchId) ?? "") : null;
    if (!niche) continue;
    niche.leads += row._count._all;
    if (row.contactStatus === "contacted") niche.contacted += row._count._all;
    if (row.contactStatus === "responded") niche.responded += row._count._all;
  }
  return [...niches.values()].filter((niche) => niche.leads > 0).sort((a, b) => b.lastSearchAt.getTime() - a.lastSearchAt.getTime());
}

export type ReactivationRequest = {
  workspaceId: string;
  niche: string;
  sequenceId: string;
  fromStep: number; // 1-based, como se muestra en pantalla
  minDaysSinceContact?: number;
  includeUnanswered?: boolean;
  now?: Date;
};

export class ReactivationError extends Error {
  constructor(readonly code: "niche_not_found" | "sequence_not_found" | "invalid_step", message: string) {
    super(message);
  }
}

/** Analiza el nicho y devuelve quién entra y por qué quedan fuera los demás. */
export async function analyzeNicheReactivation(input: ReactivationRequest) {
  const now = input.now ?? new Date();
  const workspaceId = input.workspaceId;
  const niche = (await listSequenceNiches(workspaceId)).find((item) => item.key === nicheKey(input.niche));
  if (!niche) throw new ReactivationError("niche_not_found", "No hay búsquedas de ese nicho");
  const sequence = await prisma.leadSequence.findFirst({
    where: { id: input.sequenceId, workspaceId },
    include: { steps: { orderBy: { order: "asc" } } }
  });
  if (!sequence) throw new ReactivationError("sequence_not_found", "Secuencia no encontrada");
  const steps = uniqueSequenceSteps(sequence.steps);
  const fromIndex = Math.floor(Number(input.fromStep)) - 1;
  if (!steps.length || fromIndex < 0 || fromIndex >= steps.length) throw new ReactivationError("invalid_step", `Elige un paso entre 1 y ${steps.length}`);
  const options: ReactivationOptions = {
    fromIndex,
    stepCount: steps.length,
    minDaysSinceContact: Math.max(0, Math.min(60, Number(input.minDaysSinceContact ?? 2))),
    includeUnanswered: Boolean(input.includeUnanswered),
    now
  };

  const leads = await prisma.lead.findMany({
    where: { workspaceId, searchId: { in: niche.searchIds } },
    select: {
      id: true, name: true, contactStatus: true, convertedClientId: true, commercialTaskId: true, commercialSentAt: true,
      phone: true, internationalPhone: true, placeId: true, search: { select: { source: true } }
    }
  });
  const leadIds = leads.map((lead) => lead.id);
  const phonesByLead = new Map(leads.map((lead) => [lead.id, [...new Set([normalizePhone(lead.internationalPhone), normalizePhone(lead.phone)].filter((phone): phone is string => Boolean(phone)))]]));
  const allPhones = [...new Set([...phonesByLead.values()].flat())];

  const [messages, metasByPhone, optouts, suppressions, prospects, assignments] = await Promise.all([
    inChunks(leadIds, (ids) => prisma.leadMessage.findMany({ where: { workspaceId, leadId: { in: ids } }, select: { leadId: true, status: true, sentAt: true, externalMessageId: true } })),
    inChunks(allPhones, (phones) => prisma.leadConversationMeta.findMany({ where: { workspaceId, OR: [{ phone: { in: phones } }, { realPhone: { in: phones } }] }, select: { phone: true, realPhone: true, status: true } })),
    inChunks(allPhones, (phones) => prisma.leadOptout.findMany({ where: { workspaceId, phone: { in: phones } }, select: { phone: true, leadId: true } })),
    inChunks(leadIds, (ids) => prisma.leadSuppression.findMany({
      where: { workspaceId, OR: [{ leadId: { in: ids } }, { kind: "lead", valueHash: { in: ids.map((id) => suppressionHash("lead", id)) } }] },
      select: { leadId: true, valueHash: true }
    })),
    inChunks(leadIds, (ids) => prisma.prospectingProspect.findMany({ where: { workspaceId, leadId: { in: ids }, status: "active" }, select: { leadId: true } })),
    inChunks(leadIds, (ids) => prisma.leadSequenceAssignment.findMany({ where: { leadId: { in: ids } }, select: { leadId: true, sequenceId: true, status: true, currentStep: true } }))
  ]);
  const phoneSuppressions = await inChunks(allPhones, (phones) => prisma.leadSuppression.findMany({
    where: { workspaceId, kind: "phone", valueHash: { in: phones.map((phone) => suppressionHash("phone", phone)) } },
    select: { valueHash: true }
  }));
  const extraOptouts = await inChunks(leadIds, (ids) => prisma.leadOptout.findMany({ where: { workspaceId, leadId: { in: ids } }, select: { leadId: true, phone: true } }));

  // Teléfonos ocultos (LID) cuya conversación se resolvió a un número real.
  const lidPhones = metasByPhone.filter((meta) => meta.realPhone && allPhones.includes(meta.realPhone) && meta.phone !== meta.realPhone);
  const inboxPhones = [...new Set([...allPhones, ...lidPhones.map((meta) => meta.phone)])];
  const inbox = await inChunks(inboxPhones, (phones) => prisma.leadInboxMessage.findMany({
    where: { workspaceId, phoneNormalized: { in: phones } },
    select: { leadId: true, phoneNormalized: true, direction: true, classification: true, receivedAt: true, meta: true, externalMessageId: true, body: true }
  }));
  const inboxByLeadId = await inChunks(leadIds, (ids) => prisma.leadInboxMessage.findMany({
    where: { workspaceId, leadId: { in: ids }, phoneNormalized: { notIn: inboxPhones } },
    select: { leadId: true, phoneNormalized: true, direction: true, classification: true, receivedAt: true, meta: true, externalMessageId: true, body: true }
  }));

  // Envíos automáticos conocidos (para no confundirlos con respuestas humanas).
  const settings = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const autoReplyText = String(((settings?.settings as any)?.leads?.autoReplyText ?? "")).trim();
  const automatedExternalIds = new Set(messages.map((message) => message.externalMessageId).filter((id): id is string => Boolean(id)));
  const leadsWithOutbound = new Set<string>();
  const leadByPhone = new Map<string, string>();
  for (const [leadId, phones] of phonesByLead) for (const phone of phones) leadByPhone.set(phone, leadId);
  for (const meta of lidPhones) if (meta.realPhone && leadByPhone.has(meta.realPhone)) leadByPhone.set(meta.phone, leadByPhone.get(meta.realPhone)!);
  const inboxByLead = new Map<string, typeof inbox>();
  for (const message of [...inbox, ...inboxByLeadId]) {
    const leadId = message.leadId && phonesByLead.has(message.leadId) ? message.leadId : message.phoneNormalized ? leadByPhone.get(message.phoneNormalized) : undefined;
    if (!leadId) continue;
    const list = inboxByLead.get(leadId) ?? [];
    list.push(message);
    inboxByLead.set(leadId, list);
    if (message.direction === "out") leadsWithOutbound.add(leadId);
  }
  const automatedBodies = new Set<string>();
  const autoReplyPattern = autoReplyText ? templatePattern(autoReplyText) : null;
  if (leadsWithOutbound.size) {
    const bodies = await inChunks([...leadsWithOutbound], (ids) => prisma.leadMessage.findMany({ where: { workspaceId, leadId: { in: ids } }, select: { renderedMessage: true } }));
    for (const row of bodies) if (row.renderedMessage) automatedBodies.add(normalizeBody(row.renderedMessage));
  }
  // Difusiones: mensajes masivos, no una respuesta a la conversación.
  const broadcasts = await inChunks(inboxPhones, (phones) => prisma.leadBroadcastRecipient.findMany({ where: { workspaceId, phone: { in: phones }, status: "sent" }, select: { externalMessageId: true, body: true } }));
  for (const row of broadcasts) {
    if (row.externalMessageId) automatedExternalIds.add(row.externalMessageId);
    if (row.body) automatedBodies.add(normalizeBody(row.body));
  }
  const automated = { externalIds: automatedExternalIds, bodies: automatedBodies, patterns: autoReplyPattern ? [autoReplyPattern] : [] };

  // Índices por lead.
  const messagesByLead = new Map<string, typeof messages>();
  for (const message of messages) {
    const list = messagesByLead.get(message.leadId) ?? [];
    list.push(message);
    messagesByLead.set(message.leadId, list);
  }
  const blockedPhones = new Set([...optouts, ...extraOptouts].map((row) => row.phone));
  const blockedLeadIds = new Set([...optouts, ...extraOptouts].map((row) => row.leadId).filter((id): id is string => Boolean(id)));
  const suppressedHashes = new Set([...suppressions, ...phoneSuppressions].map((row) => row.valueHash));
  for (const row of suppressions) if (row.leadId) blockedLeadIds.add(row.leadId);
  const metaStatusByPhone = new Map<string, string>();
  for (const meta of metasByPhone) {
    metaStatusByPhone.set(meta.phone, meta.status);
    if (meta.realPhone) metaStatusByPhone.set(meta.realPhone, meta.status);
  }
  const cadenceLeads = new Set(prospects.map((row) => row.leadId).filter((id): id is string => Boolean(id)));
  const assignmentsByLead = new Map<string, typeof assignments>();
  for (const row of assignments) {
    const list = assignmentsByLead.get(row.leadId) ?? [];
    list.push(row);
    assignmentsByLead.set(row.leadId, list);
  }

  const excluded: Record<ReactivationReason, number> = Object.fromEntries(Object.keys(REACTIVATION_REASONS).map((key) => [key, 0])) as Record<ReactivationReason, number>;
  const eligible: Array<{ id: string; name: string; lastSentAt: Date; existingAssignment: boolean }> = [];
  for (const lead of leads) {
    const phones = phonesByLead.get(lead.id) ?? [];
    const leadMessages = messagesByLead.get(lead.id) ?? [];
    const sentDates = leadMessages.filter((message) => SENT.has(message.status) && message.sentAt).map((message) => message.sentAt!.getTime());
    const thread = (inboxByLead.get(lead.id) ?? []).sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
    const genuineInbound = thread.filter((message) => message.direction === "in" && message.classification !== "auto_reply");
    const firstGenuine = genuineInbound[0]?.receivedAt ?? null;
    const humanReply = Boolean(firstGenuine) && thread.some((message) => message.direction === "out" && message.receivedAt > firstGenuine! && isHumanOutbound(message, automated));
    const own = assignmentsByLead.get(lead.id) ?? [];
    const thisSequence = own.find((row) => row.sequenceId === sequence.id) ?? null;
    const metaStatus = phones.map((phone) => metaStatusByPhone.get(phone)).find(Boolean) ?? null;
    const facts: ReactivationLeadFacts = {
      contactStatus: lead.contactStatus,
      isClient: Boolean(lead.convertedClientId),
      handedToCommercial: Boolean(lead.commercialSentAt || lead.commercialTaskId),
      emailOnly: isEmailOnlyLead(lead),
      hasPhone: phones.length > 0,
      blocked: blockedLeadIds.has(lead.id) || suppressedHashes.has(suppressionHash("lead", lead.id)) ||
        phones.some((phone) => blockedPhones.has(phone) || suppressedHashes.has(suppressionHash("phone", phone))) ||
        thread.some((message) => message.direction === "in" && BLOCKING_CLASSIFICATIONS.has(message.classification ?? "")),
      firstGenuineInboundAt: firstGenuine,
      humanReplyAfterInbound: humanReply,
      conversationStatus: metaStatus,
      lastSentAt: sentDates.length ? new Date(Math.max(...sentDates)) : null,
      hasPendingMessage: leadMessages.some((message) => message.status === "queued" || message.status === "sending"),
      inActiveCadence: cadenceLeads.has(lead.id),
      inOtherActiveSequence: own.some((row) => row.sequenceId !== sequence.id && row.status === "active"),
      thisSequence: thisSequence ? { status: thisSequence.status, currentStep: thisSequence.currentStep } : null
    };
    const verdict = classifyReactivationLead(facts, options);
    if (verdict.eligible) eligible.push({ id: lead.id, name: lead.name, lastSentAt: facts.lastSentAt!, existingAssignment: Boolean(thisSequence) });
    else excluded[verdict.reason]++;
  }

  // Avance de reactivaciones anteriores de esta secuencia en el nicho.
  const progress = { active: 0, completed: 0, paused: 0, stopped: 0, byStep: {} as Record<string, number>, pausedReasons: {} as Record<string, number> };
  for (const row of assignments.filter((item) => item.sequenceId === sequence.id)) {
    if (row.status === "active" || row.status === "completed" || row.status === "paused" || row.status === "stopped") progress[row.status]++;
    // Paso en curso (1-based); 0 = aún no se ha encolado el primero de la tanda.
    if (row.status === "active") progress.byStep[String(row.currentStep + 1)] = (progress.byStep[String(row.currentStep + 1)] ?? 0) + 1;
  }
  if (progress.paused) {
    const reasons = await inChunks(leadIds, (ids) => prisma.leadSequenceAssignment.findMany({ where: { leadId: { in: ids }, sequenceId: sequence.id, status: "paused" }, select: { stoppedReason: true } }));
    for (const row of reasons) {
      const reason = String(row.stoppedReason ?? "sin motivo").slice(0, 120);
      progress.pausedReasons[reason] = (progress.pausedReasons[reason] ?? 0) + 1;
    }
  }

  return {
    niche: { key: niche.key, keyword: niche.keyword, searches: niche.searchIds.length, leads: leads.length },
    sequence: {
      id: sequence.id,
      name: sequence.name,
      steps: steps.map((step, index) => ({ number: index + 1, delayDays: Math.round(stepDelayMs(step) / 86_400_000 * 10) / 10, kind: step.kind, preview: step.templateBody.slice(0, 280) }))
    },
    options: { fromStep: fromIndex + 1, minDaysSinceContact: options.minDaysSinceContact, includeUnanswered: options.includeUnanswered },
    eligible,
    excluded,
    progress
  };
}

/** Reactiva la secuencia para los leads que entran (se recalcula en el servidor). */
export async function applyNicheReactivation(input: ReactivationRequest) {
  const analysis = await analyzeNicheReactivation(input);
  const now = input.now ?? new Date();
  const currentStep = analysis.options.fromStep - 2; // último paso «hecho»: el siguiente es fromStep
  const existing = analysis.eligible.filter((lead) => lead.existingAssignment).map((lead) => lead.id);
  const fresh = analysis.eligible.filter((lead) => !lead.existingAssignment).map((lead) => lead.id);
  let resumed = 0;
  for (const ids of chunk(existing, 1000)) {
    const result = await prisma.leadSequenceAssignment.updateMany({
      where: { sequenceId: analysis.sequence.id, leadId: { in: ids }, lead: { workspaceId: input.workspaceId }, status: { not: "active" } },
      data: { status: "active", currentStep, startedAt: now, nextRunAt: now, lastMessageId: null, stoppedReason: null, completedAt: null }
    });
    resumed += result.count;
  }
  let created = 0;
  for (const ids of chunk(fresh, 1000)) {
    const result = await prisma.leadSequenceAssignment.createMany({
      data: ids.map((leadId) => ({ leadId, sequenceId: analysis.sequence.id, status: "active", currentStep, startedAt: now, nextRunAt: now })),
      skipDuplicates: true
    });
    created += result.count;
  }
  return { ...analysis, applied: { created, resumed, total: created + resumed } };
}
