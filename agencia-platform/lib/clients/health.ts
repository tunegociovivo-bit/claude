/**
 * Salud de cuenta / SLA — score DETERMINISTA, EXPLICABLE y CONFIGURABLE (FASE 3).
 *
 * Nada de puntuaciones opacas: el score parte de 100 y cada factor resta puntos
 * de forma transparente (se devuelve la lista de factores con su aportación).
 * Los pesos/umbrales son configurables (workspace settings) sobre defaults
 * seguros. Los datos ausentes NO penalizan (se marcan como desconocidos).
 */

export type HealthConfig = {
  weights: {
    overduePerInvoice: number; // puntos por factura vencida (hasta cap)
    overdueInvoiceCap: number; // máx facturas que penalizan
    staleActivity: number; // penalización si la última actividad supera el umbral
    overdueTaskPerItem: number; // puntos por tarea vencida (hasta cap)
    overdueTaskCap: number;
    noMrrActive: number; // penalización leve si cliente ACTIVE sin MRR
    stalledProject: number; // penalización si hay proyectos activos con progreso muy bajo
  };
  thresholds: {
    staleActivityDays: number; // días sin actividad para considerarla "estancada"
    stalledProgressPct: number; // progreso medio por debajo del cual un proyecto activo está "estancado"
    bandGood: number; // score >= → "good"
    bandWarn: number; // score >= → "warn"; por debajo → "risk"
  };
};

export const DEFAULT_HEALTH_CONFIG: HealthConfig = {
  weights: {
    overduePerInvoice: 12,
    overdueInvoiceCap: 4,
    staleActivity: 20,
    overdueTaskPerItem: 6,
    overdueTaskCap: 5,
    noMrrActive: 8,
    stalledProject: 15
  },
  thresholds: { staleActivityDays: 30, stalledProgressPct: 20, bandGood: 80, bandWarn: 50 }
};

/** Merge seguro de una config parcial (de settings) sobre los defaults. */
export function mergeHealthConfig(partial?: Partial<{ weights: Partial<HealthConfig["weights"]>; thresholds: Partial<HealthConfig["thresholds"]> }> | null): HealthConfig {
  return {
    weights: { ...DEFAULT_HEALTH_CONFIG.weights, ...(partial?.weights ?? {}) },
    thresholds: { ...DEFAULT_HEALTH_CONFIG.thresholds, ...(partial?.thresholds ?? {}) }
  };
}

export type HealthSignals = {
  overdueInvoiceCount: number;
  overdueAmountCents: number;
  daysSinceLastActivity: number | null; // null = sin actividad registrada (desconocido)
  openOverdueTaskCount: number;
  hasMrr: boolean;
  activeProjectCount: number;
  avgProjectProgress: number | null; // 0..100 o null si no hay proyectos activos
  status: string; // ClientStatus (ACTIVE, PAUSED, …)
};

export type HealthFactor = { key: string; label: string; points: number; detail: string };
export type HealthAlert = { level: "info" | "warn" | "critical"; message: string };
export type HealthResult = {
  score: number; // 0..100
  band: "good" | "warn" | "risk";
  factors: HealthFactor[];
  alerts: HealthAlert[];
  nextSteps: string[];
  dataQuality: { activityKnown: boolean; notes: string[] };
};

export function computeHealth(signals: HealthSignals, config: HealthConfig = DEFAULT_HEALTH_CONFIG): HealthResult {
  const w = config.weights;
  const t = config.thresholds;
  const factors: HealthFactor[] = [];
  const alerts: HealthAlert[] = [];
  const nextSteps: string[] = [];
  const notes: string[] = [];

  // Cliente no activo → informativo, no penaliza salud operativa.
  const isActive = signals.status === "ACTIVE";

  // 1) Facturas vencidas (impago) — factor determinista, penalización acotada.
  if (signals.overdueInvoiceCount > 0) {
    const n = Math.min(signals.overdueInvoiceCount, w.overdueInvoiceCap);
    const points = -(n * w.overduePerInvoice);
    // Nota: el scorer NO expone importes € (esos van gated a admin en
    // rentabilidad). Aquí solo cuentas, para poder mostrar la salud a no-admin.
    factors.push({
      key: "overdue_invoices",
      label: "Facturas vencidas",
      points,
      detail: `${signals.overdueInvoiceCount} factura(s) vencida(s) sin cobrar.`
    });
    alerts.push({ level: signals.overdueAmountCents > 0 ? "critical" : "warn", message: `Cobro pendiente vencido en ${signals.overdueInvoiceCount} factura(s).` });
    nextSteps.push("Reclamar/registrar el cobro de las facturas vencidas.");
  }

  // 2) Actividad estancada — solo si se conoce la fecha de última actividad.
  if (signals.daysSinceLastActivity === null) {
    notes.push("No hay actividad trazable registrada (proyectos/tareas/publicaciones/facturas) para medir recencia.");
  } else if (signals.daysSinceLastActivity > t.staleActivityDays) {
    factors.push({
      key: "stale_activity",
      label: "Actividad estancada",
      points: -w.staleActivity,
      detail: `Sin actividad registrada desde hace ${signals.daysSinceLastActivity} días (umbral ${t.staleActivityDays}).`
    });
    alerts.push({ level: "warn", message: `Cuenta sin actividad desde hace ${signals.daysSinceLastActivity} días.` });
    nextSteps.push("Contactar al cliente / planificar la siguiente entrega.");
  }

  // 3) Tareas vencidas abiertas.
  if (signals.openOverdueTaskCount > 0) {
    const n = Math.min(signals.openOverdueTaskCount, w.overdueTaskCap);
    factors.push({
      key: "overdue_tasks",
      label: "Tareas vencidas",
      points: -(n * w.overdueTaskPerItem),
      detail: `${signals.openOverdueTaskCount} tarea(s) abierta(s) con vencimiento pasado.`
    });
    nextSteps.push("Revisar y reprogramar las tareas vencidas.");
  }

  // 4) Cliente activo sin MRR (riesgo de relación no recurrente) — penalización leve.
  if (isActive && !signals.hasMrr) {
    factors.push({ key: "no_mrr", label: "Sin MRR", points: -w.noMrrActive, detail: "Cliente activo sin ingreso recurrente (MRR) configurado." });
  }

  // 5) Proyectos activos estancados (progreso medio muy bajo).
  if (signals.activeProjectCount > 0 && signals.avgProjectProgress !== null && signals.avgProjectProgress < t.stalledProgressPct) {
    factors.push({
      key: "stalled_projects",
      label: "Proyectos estancados",
      points: -w.stalledProject,
      detail: `${signals.activeProjectCount} proyecto(s) activo(s) con progreso medio ${signals.avgProjectProgress}% (< ${t.stalledProgressPct}%).`
    });
    nextSteps.push("Desbloquear/impulsar los proyectos con progreso bajo.");
  }

  if (!isActive) {
    factors.push({ key: "status", label: "Estado", points: 0, detail: `Cliente en estado ${signals.status}: la salud operativa es informativa.` });
  }

  const penalty = factors.reduce((s, f) => s + f.points, 0); // f.points ya son ≤ 0
  const score = Math.max(0, Math.min(100, 100 + penalty));
  const band: HealthResult["band"] = score >= t.bandGood ? "good" : score >= t.bandWarn ? "warn" : "risk";

  return {
    score,
    band,
    factors,
    alerts,
    nextSteps,
    dataQuality: { activityKnown: signals.daysSinceLastActivity !== null, notes }
  };
}
