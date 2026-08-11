/**
 * Priorización, partición actual/histórico, clustering del ruido y secciones
 * ejecutivas de la bandeja de excepciones (Slice 2a) — lógica PURA (sin BD, sin
 * React → testeable).
 *
 * Reemplaza el sesgo "más antiguo primero" por un score de accionabilidad: la
 * severidad (por impacto, no por edad) domina; la recencia añade (lo reciente
 * encabeza); la fuente desempata. Lo muy antiguo se agrupa como histórico y NO
 * se pierde: se contabiliza y se ofrece limpieza en lote.
 */
import { ACTIVE_WINDOW_DAYS, type ExceptionItem, type ExceptionSource, type ExceptionKind, type Severity } from "./engine";

const DAY = 86_400_000;

const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 1000, high: 300, medium: 100, low: 20 };
const SOURCE_WEIGHT: Record<ExceptionSource, number> = {
  ai_run: 50, // bloqueos de SONIA → actuar ya
  ai_draft: 40, // aprobaciones/errores de acción
  invoice: 30, // cobros
  lead_inbox: 20,
  cron: 20,
  task: 10
};
const SEVERITY_RANK: Record<Severity, number> = { critical: 3, high: 2, medium: 1, low: 0 };

/** Score de prioridad: severidad (impacto) domina; recencia (0..60, decae con la
 *  edad) hace que lo reciente encabece; la fuente desempata. */
export function scoreItem(it: ExceptionItem): number {
  const days = it.ageMs / DAY;
  const recency = Math.max(0, 60 - days);
  return SEVERITY_WEIGHT[it.severity] + recency + (SOURCE_WEIGHT[it.source] ?? 0);
}

/** Orden por prioridad desc; a igualdad, lo más reciente primero. */
export function sortByPriority(items: ExceptionItem[]): ExceptionItem[] {
  return items.slice().sort((a, b) => scoreItem(b) - scoreItem(a) || a.ageMs - b.ageMs);
}

/** Solo task/invoice pueden ser "históricos" (drafts/runs ya van acotados por la
 *  ventana `since` del aggregator y son siempre accionables). */
export function isHistorical(it: ExceptionItem, activeWindowDays = ACTIVE_WINDOW_DAYS): boolean {
  if (it.source !== "task" && it.source !== "invoice") return false;
  return it.ageMs > activeWindowDays * DAY;
}

export function partition(items: ExceptionItem[], activeWindowDays = ACTIVE_WINDOW_DAYS): { active: ExceptionItem[]; historical: ExceptionItem[] } {
  const active: ExceptionItem[] = [];
  const historical: ExceptionItem[] = [];
  for (const it of items) (isHistorical(it, activeWindowDays) ? historical : active).push(it);
  return { active, historical };
}

// ── Clustering del histórico ────────────────────────────────────────────────
export type Cluster = {
  key: string;
  source: ExceptionSource;
  kind: ExceptionKind;
  clientId: string | null;
  clientName: string | null;
  count: number;
  oldestMs: number; // antigüedad del más viejo
  newestMs: number;
  sampleIds: string[]; // hasta 20, para drill-down/limpieza en lote
  label: string;
};

const SOURCE_NOUN: Record<ExceptionSource, string> = {
  task: "tareas vencidas",
  invoice: "facturas vencidas",
  ai_draft: "acciones de SONIA",
  ai_run: "ejecuciones de SONIA",
  lead_inbox: "mensajes",
  cron: "automatizaciones"
};

/** Agrupa el histórico por (source, kind, cliente). Un cluster = una tarjeta
 *  resumida con conteo y drill-down. */
export function clusterHistorical(historical: ExceptionItem[], activeWindowDays = ACTIVE_WINDOW_DAYS): Cluster[] {
  const map = new Map<string, Cluster>();
  for (const it of historical) {
    const key = `${it.source}:${it.kind}:${it.clientId ?? "-"}`;
    let c = map.get(key);
    if (!c) {
      c = {
        key,
        source: it.source,
        kind: it.kind,
        clientId: it.clientId ?? null,
        clientName: it.clientName ?? null,
        count: 0,
        oldestMs: 0,
        newestMs: Number.MAX_SAFE_INTEGER,
        sampleIds: [],
        label: ""
      };
      map.set(key, c);
    }
    c.count++;
    c.oldestMs = Math.max(c.oldestMs, it.ageMs);
    c.newestMs = Math.min(c.newestMs, it.ageMs);
    if (c.sampleIds.length < 20) c.sampleIds.push(it.id);
    if (!c.clientName && it.clientName) c.clientName = it.clientName;
  }
  const out = [...map.values()];
  for (const c of out) {
    const noun = SOURCE_NOUN[c.source] ?? "incidencias";
    const who = c.clientName ? ` · ${c.clientName}` : "";
    c.label = `${c.count} ${noun} hace más de ${activeWindowDays} días${who}`;
  }
  // Más grandes primero (más ruido que limpiar).
  return out.sort((a, b) => b.count - a.count || b.oldestMs - a.oldestMs);
}

// ── Secciones ejecutivas (inicio) ───────────────────────────────────────────
export type ClientRisk = {
  clientId: string;
  clientName: string | null;
  count: number;
  maxSeverity: Severity;
  items: ExceptionItem[];
};

export type Sections = {
  today: ExceptionItem[]; // vence/recién vencido hoy → accionable ya
  blockers: ExceptionItem[]; // bloqueos reales de SONIA
  billingSla: ExceptionItem[]; // cobros / SLA
  clientsAtRisk: ClientRisk[]; // agregado por cliente
};

const BLOCKER_KINDS = new Set<ExceptionKind>(["automation_failed", "message_unresolved", "sla_breached", "approval_pending"]);

/** Construye las secciones ejecutivas sobre el conjunto ACTIVO ya priorizado.
 *  Un ítem puede aparecer en más de una sección (vista, no partición). */
export function buildSections(active: ExceptionItem[], _now?: Date): Sections {
  const today = active.filter((it) => it.ageMs <= DAY);
  const blockers = active.filter((it) => (it.source === "ai_run" || it.source === "ai_draft") && BLOCKER_KINDS.has(it.kind));
  const billingSla = active.filter((it) => it.source === "invoice");

  const byClient = new Map<string, ClientRisk>();
  for (const it of active) {
    if (!it.clientId) continue;
    let r = byClient.get(it.clientId);
    if (!r) {
      r = { clientId: it.clientId, clientName: it.clientName ?? null, count: 0, maxSeverity: "low", items: [] };
      byClient.set(it.clientId, r);
    }
    r.count++;
    r.items.push(it);
    if (!r.clientName && it.clientName) r.clientName = it.clientName;
    if (SEVERITY_RANK[it.severity] > SEVERITY_RANK[r.maxSeverity]) r.maxSeverity = it.severity;
  }
  // "En riesgo" = ≥2 incidencias o alguna crítica/alta.
  const clientsAtRisk = [...byClient.values()]
    .filter((r) => r.count >= 2 || SEVERITY_RANK[r.maxSeverity] >= SEVERITY_RANK.high)
    .sort((a, b) => SEVERITY_RANK[b.maxSeverity] - SEVERITY_RANK[a.maxSeverity] || b.count - a.count);

  return { today, blockers, billingSla, clientsAtRisk };
}

// ── "Trabajo completado por SONIA" ──────────────────────────────────────────
export type DoneItem = {
  id: string;
  taskId: string;
  title: string;
  summary: string | null;
  at: string; // ISO
  ageMs: number;
  link: string;
};
export type DoneRunRow = { id: string; taskId: string; summary: string | null; finishedAt: Date | null; createdAt: Date };

/** Runs SUCCEEDED recientes → evidencia de valor (sección "Hecho por SONIA"). */
export function fromDoneRuns(rows: DoneRunRow[], now: Date): DoneItem[] {
  return rows.map((r) => {
    const at = r.finishedAt ?? r.createdAt;
    return {
      id: `done:${r.id}`,
      taskId: r.taskId,
      title: (r.summary ?? "Tarea completada por SONIA").slice(0, 120),
      summary: r.summary ? r.summary.slice(0, 200) : null,
      at: at.toISOString(),
      ageMs: Math.max(0, now.getTime() - at.getTime()),
      link: `/tareas?task=${r.taskId}`
    };
  });
}
