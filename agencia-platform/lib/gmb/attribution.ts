/**
 * Attribution/ROI — engine PURO. UTM builder validado, deduplicación de eventos, agregación con
 * comparación temporal y progreso de objetivos. NUNCA inventa conversiones ni atribuye sin evidencia:
 * solo cuenta eventos REALES registrados. Sin red.
 */
import { createHash } from "node:crypto";

export type EventType = "click" | "call" | "directions" | "request";
export const EVENT_TYPES: EventType[] = ["click", "call", "directions", "request"];

export type UtmParams = { source: string; medium: string; campaign: string; term?: string; content?: string };
export type UtmValidation = { ok: boolean; errors: string[]; url?: string };

const cleanParam = (v?: string) => (v ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "-").replace(/[^a-z0-9._\-]/g, "");

/** Valida y construye una URL con UTMs. Requiere base http(s) y source/medium/campaign. */
export function validateUtm(base: string, params: UtmParams): UtmValidation {
  const errors: string[] = [];
  let url: URL | null = null;
  try { url = new URL(/^https?:/i.test(base) ? base : `https://${base}`); } catch { errors.push("URL base inválida."); }
  const source = cleanParam(params.source), medium = cleanParam(params.medium), campaign = cleanParam(params.campaign);
  if (!source) errors.push("utm_source es obligatorio.");
  if (!medium) errors.push("utm_medium es obligatorio.");
  if (!campaign) errors.push("utm_campaign es obligatorio.");
  if (errors.length || !url) return { ok: false, errors };
  url.searchParams.set("utm_source", source);
  url.searchParams.set("utm_medium", medium);
  url.searchParams.set("utm_campaign", campaign);
  if (params.term) url.searchParams.set("utm_term", cleanParam(params.term));
  if (params.content) url.searchParams.set("utm_content", cleanParam(params.content));
  return { ok: true, errors: [], url: url.toString() };
}

export function buildUtmUrl(base: string, params: UtmParams): string {
  const v = validateUtm(base, params);
  return v.url ?? base;
}

/** Clave de deduplicación de un evento: mismo cliente+tipo+fingerprint en el mismo día = 1 evento. */
export function eventDedupKey(clientId: string, type: EventType, fingerprint: string, dayISO: string): string {
  return createHash("sha1").update(`${clientId}|${type}|${fingerprint}|${dayISO}`).digest("hex").slice(0, 32);
}

/** Fingerprint sin PII (hash de ip+ua). No identifica a la persona. */
export function fingerprintOf(ip: string, ua: string): string {
  return createHash("sha256").update(`${ip}|${ua}`).digest("hex").slice(0, 24);
}

export type AttrEvent = { type: EventType; source?: string; campaign?: string; occurredAt: string | Date };

function inRange(d: Date, from: Date, to: Date) { const t = d.getTime(); return t >= from.getTime() && t <= to.getTime(); }

export type AttributionAgg = {
  current: Record<EventType, number>;
  previous: Record<EventType, number>;
  deltaPct: Record<EventType, number | null>;
  bySource: { source: string; count: number }[];
  byCampaign: { campaign: string; count: number }[];
  total: number;
};

/** Agrega eventos por tipo (periodo actual vs anterior) + por fuente/campaña. Solo eventos reales. */
export function aggregateEvents(events: AttrEvent[], from: Date, to: Date, prevFrom: Date, prevTo: Date): AttributionAgg {
  const zero = (): Record<EventType, number> => ({ click: 0, call: 0, directions: 0, request: 0 });
  const current = zero(), previous = zero();
  const bySource = new Map<string, number>(), byCampaign = new Map<string, number>();
  for (const e of events) {
    const d = new Date(e.occurredAt);
    if (inRange(d, from, to)) {
      current[e.type] = (current[e.type] ?? 0) + 1;
      const s = (e.source || "directo").toLowerCase(); bySource.set(s, (bySource.get(s) ?? 0) + 1);
      const c = (e.campaign || "sin-campaña").toLowerCase(); byCampaign.set(c, (byCampaign.get(c) ?? 0) + 1);
    } else if (inRange(d, prevFrom, prevTo)) {
      previous[e.type] = (previous[e.type] ?? 0) + 1;
    }
  }
  const deltaPct = {} as Record<EventType, number | null>;
  for (const t of EVENT_TYPES) deltaPct[t] = previous[t] > 0 ? Math.round(((current[t] - previous[t]) / previous[t]) * 100) : (current[t] > 0 ? null : 0);
  const total = EVENT_TYPES.reduce((s, t) => s + current[t], 0);
  return { current, previous, deltaPct, bySource: [...bySource.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count).slice(0, 10), byCampaign: [...byCampaign.entries()].map(([campaign, count]) => ({ campaign, count })).sort((a, b) => b.count - a.count).slice(0, 10), total };
}

export type Goal = { metric: string; target: number };
export type GoalProgress = { metric: string; target: number; actual: number; pct: number };

/** Progreso de objetivos: métrica → actual (de los eventos actuales), % cumplido. */
export function goalProgress(current: Record<EventType, number>, goals: Goal[]): GoalProgress[] {
  const metricToType: Record<string, EventType> = { clicks: "click", calls: "call", directions: "directions", requests: "request" };
  return goals.map((g) => {
    const t = metricToType[g.metric];
    const actual = t ? current[t] : 0;
    return { metric: g.metric, target: g.target, actual, pct: g.target > 0 ? Math.min(100, Math.round((actual / g.target) * 100)) : 0 };
  });
}
