import { normalizeOpportunitySignal, scoreOpportunitySignal, SIGNAL_LABELS, type NormalizedOpportunitySignal } from "./core";

export function recommendedOffer(signal: NormalizedOpportunitySignal) {
  const offers: Record<string, string> = {
    grant_awarded: "Plan de ejecución financiable: convertir la ayuda concedida en captación, lanzamiento y resultados justificables.",
    tender_won: "Plan de activación y comunicación del contrato adjudicado, con entregables y calendario desde el primer día.",
    capital_increase: "Sprint de crecimiento posterior a la ampliación: adquisición, posicionamiento y expansión comercial.",
    ownership_or_director_change: "Plan de primeros 100 días: diagnóstico comercial, reposicionamiento y victorias rápidas para la nueva dirección.",
    new_location: "Launch Room de apertura: demanda local, campaña previa, captación y reputación del nuevo establecimiento.",
    franchise_expansion: "Motor de expansión: territorios, operadores, captación de franquiciados y lanzamiento de unidades.",
    commercial_hiring: "Sistema de demanda y enablement para que el nuevo equipo comercial empiece con pipeline, mensajes y seguimiento.",
    investment_received: "Growth deployment: asignación del capital a campañas medibles, expansión y adquisición de clientes.",
    company_or_trademark_registered: "Go-to-market de nueva empresa o marca: posicionamiento, activos de lanzamiento y primeras oportunidades.",
    upcoming_campaign_opening_or_launch: "War Room de lanzamiento: creatividades, distribución, captación y medición en tiempo real."
  };
  return offers[signal.type];
}

export function nextBestAction(signal: NormalizedOpportunitySignal, score: number) {
  if (score >= 80) return "Preparar propuesta preventiva y contactar al decisor en menos de 24 horas.";
  if (score >= 60) return "Contrastar una segunda fuente, identificar al decisor y generar un diagnóstico breve.";
  return "Mantener en observación hasta confirmar presupuesto, fecha o responsable.";
}

export async function ingestOpportunitySignal(prisma: any, workspaceId: string, input: unknown) {
  const normalized = normalizeOpportunitySignal(input);
  const scored = scoreOpportunitySignal({
    type: normalized.type,
    occurredAt: normalized.occurredAt ?? null,
    discoveredAt: new Date(),
    amount: normalized.amount ?? null,
    evidenceCount: normalized.evidenceCount,
    sourceAuthority: normalized.sourceAuthority,
    hasDecisionMaker: Boolean(normalized.decisionMakerName || normalized.decisionMakerRole),
    hasContactChannel: Boolean(normalized.email || normalized.phone || normalized.website)
  });
  const data = {
    type: normalized.type,
    companyName: normalized.companyName,
    companyTaxId: normalized.companyTaxId ?? null,
    title: normalized.title || `${SIGNAL_LABELS[normalized.type]} · ${normalized.companyName}`,
    summary: normalized.summary,
    sourceUrl: normalized.sourceUrl,
    sourceName: normalized.sourceName,
    sourceAuthority: normalized.sourceAuthority,
    occurredAt: normalized.occurredAt ?? null,
    amount: normalized.amount ?? null,
    currency: normalized.currency,
    location: normalized.location ?? null,
    evidenceCount: normalized.evidenceCount,
    evidence: normalized.evidence,
    decisionMakerName: normalized.decisionMakerName ?? null,
    decisionMakerRole: normalized.decisionMakerRole ?? null,
    email: normalized.email ?? null,
    phone: normalized.phone ?? null,
    website: normalized.website ?? null,
    score: scored.score,
    tier: scored.tier,
    scoreReasons: scored.reasons,
    recommendedOffer: recommendedOffer(normalized),
    nextBestAction: nextBestAction(normalized, scored.score),
    metadata: normalized.metadata
  };
  return prisma.opportunitySignal.upsert({
    where: { workspaceId_fingerprint: { workspaceId, fingerprint: normalized.fingerprint } },
    create: { workspaceId, fingerprint: normalized.fingerprint, ...data },
    update: data
  });
}

export async function convertSignalToLead(prisma: any, workspaceId: string, id: string) {
  return prisma.$transaction(async (tx: any) => {
    const signal = await tx.opportunitySignal.findFirst({ where: { id, workspaceId } });
    if (!signal) return null;
    if (signal.leadId) {
      await queueOpportunityResearch(tx, workspaceId, signal, signal.leadId);
      return { signal, leadId: signal.leadId, created: false, automation: "decision_maker_research_queued" };
    }
    const lead = await tx.lead.create({
      data: {
        workspaceId,
        placeId: `opportunity:${signal.fingerprint}`,
        name: signal.companyName,
        province: signal.location,
        phone: signal.phone,
        email: signal.email,
        website: signal.website,
        category: "Opportunity Hunter",
        score: signal.score,
        urgency: signal.tier === "hot" ? "critica" : signal.tier === "warm" ? "alta" : "media",
        ticketScore: signal.score,
        ticketTier: signal.tier === "hot" ? "premium" : signal.tier === "warm" ? "alto" : "medio",
        notes: `Señal: ${signal.title}\n\n${signal.summary}\n\nOferta recomendada: ${signal.recommendedOffer}`,
        aiOpener: signal.nextBestAction,
        rawData: { source: "opportunity_hunter", signalId: signal.id, type: signal.type, title: signal.title, summary: signal.summary, sourceUrl: signal.sourceUrl, recommendedOffer: signal.recommendedOffer, opportunityWorkflow: { status: "researching", queuedAt: new Date().toISOString() }, franchiseOwner: { status: "queued", queuedAt: new Date().toISOString(), attempts: 0, brand: signal.companyName } }
      }
    });
    await tx.opportunitySignal.updateMany({ where: { id, workspaceId }, data: { leadId: lead.id, status: "converted" } });
    return { signal, leadId: lead.id, created: true, automation: "decision_maker_research_queued" };
  });
}

export async function startOpportunityResearch(prisma: any, workspaceId: string, id: string) {
  return prisma.$transaction(async (tx: any) => {
    const signal = await tx.opportunitySignal.findFirst({ where: { id, workspaceId } });
    if (!signal?.leadId) return null;
    await queueOpportunityResearch(tx, workspaceId, signal, signal.leadId);
    return { leadId: signal.leadId, automation: "decision_maker_research_queued" };
  });
}

async function queueOpportunityResearch(tx: any, workspaceId: string, signal: any, leadId: string) {
  const lead = await tx.lead.findFirst({ where: { id: leadId, workspaceId }, select: { rawData: true } });
  if (!lead) return;
  const raw = lead.rawData && typeof lead.rawData === "object" ? lead.rawData : {};
  const now = new Date().toISOString();
  await tx.lead.updateMany({ where: { id: leadId, workspaceId }, data: { rawData: { ...raw, opportunityWorkflow: { status: "researching", queuedAt: now }, franchiseOwner: { status: "queued", queuedAt: now, attempts: 0, brand: signal.companyName } } } });
}
