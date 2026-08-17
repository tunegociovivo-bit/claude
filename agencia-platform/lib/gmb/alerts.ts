/**
 * Motor de ALERTAS + SLA — PURO. Evalúa señales agregadas de una ficha contra reglas y produce
 * candidatos de alerta (con dedupKey, severidad y enlace profundo). Deduplicación y transiciones
 * (ack/resolve) deterministas. Sin red ni Prisma. Nunca simula envíos externos.
 */
export type AlertSeverity = "info" | "warning" | "critical";
export type AlertType = "unreplied_reviews" | "broken_citation" | "ranking_drop" | "content_stale" | "connection_down" | "negative_review";
export type AlertStatus = "open" | "ack" | "resolved";

export type AlertRuleConfig = { enabled: boolean; severity?: AlertSeverity; threshold?: number };
export type AlertRules = Partial<Record<AlertType, AlertRuleConfig>>;

// Umbrales y severidad por defecto por tipo.
const DEFAULTS: Record<AlertType, { severity: AlertSeverity; threshold: number }> = {
  unreplied_reviews: { severity: "warning", threshold: 1 },
  negative_review: { severity: "critical", threshold: 1 },
  broken_citation: { severity: "warning", threshold: 1 },
  ranking_drop: { severity: "warning", threshold: 1 },
  content_stale: { severity: "info", threshold: 30 }, // días sin publicar
  connection_down: { severity: "warning", threshold: 1 }
};

// SLA: minutos objetivo de respuesta por severidad.
export const SLA_MINUTES: Record<AlertSeverity, number> = { critical: 120, warning: 1440, info: 4320 };

export type AlertSignals = {
  unrepliedReviews: number;
  negativeUnreplied: number;
  brokenCitations: number;
  rankingDropKeywords: number;
  daysSinceLastPost: number | null; // null = nunca publicó
  connectionDown: boolean;
};

export type AlertCandidate = { type: AlertType; severity: AlertSeverity; title: string; body: string; dedupKey: string; deepLink: string; data: any };

function ruleFor(type: AlertType, rules: AlertRules): { enabled: boolean; severity: AlertSeverity; threshold: number } {
  const d = DEFAULTS[type];
  const r = rules[type];
  return { enabled: r?.enabled ?? true, severity: r?.severity ?? d.severity, threshold: r?.threshold ?? d.threshold };
}

/** Evalúa las señales de una ficha y devuelve los candidatos de alerta (uno por tipo disparado). */
export function evaluateAlerts(clientId: string, signals: AlertSignals, rules: AlertRules = {}): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  const dk = (t: string) => `${clientId}:${t}`;
  const push = (type: AlertType, cond: boolean, title: string, body: string, tab: string, data: any = {}) => {
    const r = ruleFor(type, rules);
    if (!r.enabled || !cond) return;
    out.push({ type, severity: r.severity, title, body, dedupKey: dk(type), deepLink: `/gmb-hub?client=${clientId}&tab=${tab}`, data });
  };

  push("negative_review", signals.negativeUnreplied >= ruleFor("negative_review", rules).threshold, "Reseña negativa sin responder", `${signals.negativeUnreplied} reseña(s) negativa(s) sin respuesta.`, "reseñas", { count: signals.negativeUnreplied });
  push("unreplied_reviews", signals.unrepliedReviews >= ruleFor("unreplied_reviews", rules).threshold, "Reseñas sin responder", `${signals.unrepliedReviews} reseña(s) pendiente(s) de respuesta.`, "reseñas", { count: signals.unrepliedReviews });
  push("broken_citation", signals.brokenCitations >= ruleFor("broken_citation", rules).threshold, "Citaciones inconsistentes", `${signals.brokenCitations} citación(es) con NAP inconsistente o error.`, "citaciones", { count: signals.brokenCitations });
  push("ranking_drop", signals.rankingDropKeywords >= ruleFor("ranking_drop", rules).threshold, "Caída de ranking", `${signals.rankingDropKeywords} keyword(s) han bajado de posición.`, "rank", { count: signals.rankingDropKeywords });
  const staleThr = ruleFor("content_stale", rules).threshold;
  push("content_stale", signals.daysSinceLastPost != null && signals.daysSinceLastPost >= staleThr, "Contenido vencido", `${signals.daysSinceLastPost} días sin publicar (umbral ${staleThr}).`, "contenido", { days: signals.daysSinceLastPost });
  push("connection_down", signals.connectionDown, "Conexión caída", "Falta una conexión necesaria (Maps/Make).", "conexiones", {});
  return out;
}

// Transiciones de estado de alerta.
export type AlertCommand = "ack" | "resolve" | "reopen";
export function computeAlertTransition(status: AlertStatus, command: AlertCommand): { ok: boolean; next?: AlertStatus; error?: string } {
  const map: Record<AlertCommand, { from: AlertStatus[]; to: AlertStatus }> = {
    ack: { from: ["open"], to: "ack" },
    resolve: { from: ["open", "ack"], to: "resolved" },
    reopen: { from: ["ack", "resolved"], to: "open" }
  };
  const rule = map[command];
  if (!rule) return { ok: false, error: "comando desconocido" };
  if (!rule.from.includes(status)) return { ok: false, error: `transición inválida ${status} → ${command}` };
  return { ok: true, next: rule.to };
}

/** Orden por severidad (critical primero) y luego por antigüedad. */
export const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
