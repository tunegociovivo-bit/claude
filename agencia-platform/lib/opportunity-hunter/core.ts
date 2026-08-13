import { createHash } from "node:crypto";
import { z } from "zod";

export const OPPORTUNITY_SIGNAL_TYPES = [
  "grant_awarded",
  "tender_won",
  "capital_increase",
  "ownership_or_director_change",
  "new_location",
  "franchise_expansion",
  "commercial_hiring",
  "investment_received",
  "company_or_trademark_registered",
  "upcoming_campaign_opening_or_launch"
] as const;

export type OpportunitySignalType = (typeof OPPORTUNITY_SIGNAL_TYPES)[number];
export type SourceAuthority = "official" | "verified_media" | "company" | "unknown";

export const opportunitySignalSchema = z.object({
  type: z.enum(OPPORTUNITY_SIGNAL_TYPES),
  companyName: z.string().trim().min(2).max(240),
  companyTaxId: z.string().trim().max(32).nullable().optional(),
  title: z.string().trim().min(3).max(320),
  summary: z.string().trim().min(3).max(5_000),
  sourceUrl: z.string().url().max(2_000),
  sourceName: z.string().trim().min(2).max(160),
  sourceAuthority: z.enum(["official", "verified_media", "company", "unknown"]).default("unknown"),
  occurredAt: z.coerce.date().nullable().optional(),
  amount: z.coerce.number().finite().nonnegative().nullable().optional(),
  currency: z.string().trim().length(3).default("EUR"),
  location: z.string().trim().max(240).nullable().optional(),
  evidenceCount: z.coerce.number().int().min(1).max(20).default(1),
  decisionMakerName: z.string().trim().max(200).nullable().optional(),
  decisionMakerRole: z.string().trim().max(200).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  website: z.string().url().nullable().optional(),
  evidence: z.array(z.object({
    url: z.string().url(),
    title: z.string().max(320),
    publisher: z.string().max(160).optional(),
    publishedAt: z.coerce.date().nullable().optional()
  })).max(20).default([]),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export type NormalizedOpportunitySignal = z.infer<typeof opportunitySignalSchema>;

function canonical(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(s\.?l\.?|s\.?a\.?|sociedad limitada|sociedad anonima)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function canonicalUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
  }
  return `${url.origin}${url.pathname}${url.search}`.replace(/\/$/, "");
}

export function buildSignalFingerprint(input: Pick<NormalizedOpportunitySignal, "type" | "companyName" | "companyTaxId" | "sourceUrl" | "occurredAt">) {
  const identity = canonical(input.companyTaxId) || canonical(input.companyName);
  const day = input.occurredAt ? new Date(input.occurredAt).toISOString().slice(0, 10) : "unknown";
  return createHash("sha256")
    .update([input.type, identity, canonicalUrl(input.sourceUrl), day].join("|"))
    .digest("hex");
}

export function normalizeOpportunitySignal(input: unknown) {
  const parsed = opportunitySignalSchema.parse(input);
  return { ...parsed, fingerprint: buildSignalFingerprint(parsed) };
}

const TYPE_WEIGHT: Record<OpportunitySignalType, number> = {
  grant_awarded: 28,
  tender_won: 30,
  capital_increase: 25,
  ownership_or_director_change: 15,
  new_location: 24,
  franchise_expansion: 24,
  commercial_hiring: 18,
  investment_received: 30,
  company_or_trademark_registered: 12,
  upcoming_campaign_opening_or_launch: 22
};

export function scoreOpportunitySignal(input: {
  type: OpportunitySignalType;
  occurredAt: Date | null;
  discoveredAt: Date;
  amount: number | null;
  evidenceCount: number;
  sourceAuthority: SourceAuthority;
  hasDecisionMaker: boolean;
  hasContactChannel: boolean;
}) {
  let score = TYPE_WEIGHT[input.type];
  const reasons: string[] = [];
  if (input.occurredAt) {
    const ageDays = Math.max(0, (input.discoveredAt.getTime() - input.occurredAt.getTime()) / 86_400_000);
    if (ageDays <= 7) { score += 24; reasons.push("Señal de los últimos 7 días"); }
    else if (ageDays <= 30) { score += 14; reasons.push("Señal reciente"); }
    else if (ageDays <= 90) score += 5;
  }
  if (input.amount && input.amount >= 50_000) { score += 20; reasons.push("Presupuesto confirmado"); }
  else if (input.amount && input.amount >= 10_000) { score += 12; reasons.push("Importe público disponible"); }
  if (input.sourceAuthority === "official") { score += 12; reasons.push("Fuente oficial"); }
  else if (input.sourceAuthority === "verified_media" || input.sourceAuthority === "company") score += 6;
  if (input.evidenceCount >= 2) { score += 6; reasons.push("Evidencia contrastada"); }
  if (input.hasDecisionMaker) { score += 5; reasons.push("Decisor identificado"); }
  if (input.hasContactChannel) { score += 5; reasons.push("Canal de contacto disponible"); }
  score = Math.max(0, Math.min(100, score));
  return { score, tier: score >= 80 ? "hot" : score >= 60 ? "warm" : "watch", reasons } as const;
}

export const SIGNAL_LABELS: Record<OpportunitySignalType, string> = {
  grant_awarded: "Subvención concedida",
  tender_won: "Licitación adjudicada",
  capital_increase: "Ampliación de capital",
  ownership_or_director_change: "Cambio de administrador o propietario",
  new_location: "Nueva ubicación",
  franchise_expansion: "Expansión de franquicia",
  commercial_hiring: "Contratación comercial/marketing",
  investment_received: "Inversión recibida",
  company_or_trademark_registered: "Nueva empresa o marca",
  upcoming_campaign_opening_or_launch: "Campaña, apertura o lanzamiento próximo"
};
