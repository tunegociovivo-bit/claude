/**
 * Motor de la bandeja de EXCEPCIONES unificada (FASE 4a) — lógica PURA.
 *
 * Normaliza incidencias que requieren intervención humana desde varias fuentes
 * (automatizaciones fallidas, aprobaciones pendientes, SLA vencidos, cobros/
 * facturas problemáticos, mensajes sin resolver, tareas bloqueadas) a un ítem
 * común con deduplicación, severidad, antigüedad, origen, responsable y enlace
 * accionable, más la explicación "por qué está aquí / qué hará SONIA / qué
 * necesita de mí". Sin acceso a BD: los collectors reciben filas y devuelven ítems.
 */

export type ExceptionSource = "ai_draft" | "ai_run" | "invoice" | "task" | "lead_inbox" | "cron";
export type ExceptionKind =
  | "approval_pending"
  | "automation_failed"
  | "sla_breached"
  | "billing_problem"
  | "message_unresolved"
  | "task_blocked";
export type Severity = "low" | "medium" | "high" | "critical";

const SEVERITY_RANK: Record<Severity, number> = { critical: 3, high: 2, medium: 1, low: 0 };

/** Banda cualitativa de importe (NUNCA se expone el € exacto). */
export type AmountBand = "bajo" | "medio" | "alto";

export type ExceptionItem = {
  id: string;
  dedupeKey: string; // identidad de la incidencia (para deduplicar)
  source: ExceptionSource;
  kind: ExceptionKind;
  severity: Severity;
  title: string;
  detail: string;
  ownerUserId: string | null;
  clientId: string | null;
  clientName?: string | null; // nombre (campo PUBLIC del cliente), para contexto
  amountBand?: AmountBand | null; // solo facturación; banda, no importe
  createdAt: string; // ISO
  ageMs: number;
  link: string; // ruta relativa accionable
  why: string; // por qué está aquí
  soniaWillDo: string | null; // qué hará SONIA (o null = nada de forma autónoma)
  needsFromMe: string; // qué necesita de mí
};

const ageOf = (d: Date, now: Date) => Math.max(0, now.getTime() - d.getTime());
const DAY = 86_400_000;

/** Ventana (días) por defecto para considerar una incidencia "actual/accionable".
 *  Lo más antiguo se agrupa como histórico, no se pierde. */
export const ACTIVE_WINDOW_DAYS = 90;

/** Banda de importe a partir de céntimos pendientes (cualitativa, sin € exacto). */
export function amountBandFromCents(cents: number): AmountBand {
  if (cents >= 200_000) return "alto"; // ≥ 2000 €
  if (cents >= 50_000) return "medio"; // ≥ 500 €
  return "bajo";
}

// ── Collectors (puros) ──────────────────────────────────────────────────────

export type AiDraftRow = { id: string; kind: string; status: string; taskId: string | null; reviewedById: string | null; createdAt: Date };
export function fromAiDrafts(rows: AiDraftRow[], now: Date): ExceptionItem[] {
  const MONEY = new Set(["HOLDED_INVOICE", "HOLDED_QUOTE", "STRIPE_PAYMENT_LINK"]);
  const MSG = new Set(["EMAIL", "WHATSAPP", "PHONE_CALL"]);
  const out: ExceptionItem[] = [];
  for (const r of rows) {
    if (r.status === "PENDING") {
      const sev: Severity = MONEY.has(r.kind) ? "high" : MSG.has(r.kind) ? "high" : "medium";
      out.push({
        id: `ai_draft:${r.id}`,
        dedupeKey: `approval:ai_draft:${r.id}`,
        source: "ai_draft",
        kind: "approval_pending",
        severity: sev,
        title: `Borrador de SONIA pendiente de aprobación (${r.kind})`,
        detail: `SONIA preparó una acción de tipo ${r.kind} que espera tu revisión.`,
        ownerUserId: r.reviewedById ?? null,
        clientId: null,
        createdAt: r.createdAt.toISOString(),
        ageMs: ageOf(r.createdAt, now),
        link: `/admin/nv-ia/drafts/${r.id}`,
        why: "Es una acción sensible que SONIA no ejecuta sin tu aprobación.",
        soniaWillDo: "Ejecutará la acción solo si la apruebas; si la rechazas, no hace nada.",
        needsFromMe: "Aprobar o rechazar el borrador."
      });
    } else if (r.status === "FAILED") {
      out.push({
        id: `ai_draft:${r.id}`,
        // Si el borrador viene de una tarea, comparte dedupeKey con el fallo del
        // run de esa tarea → una sola incidencia (no doble conteo).
        dedupeKey: r.taskId ? `failed:task:${r.taskId}` : `failed:ai_draft:${r.id}`,
        source: "ai_draft",
        kind: "automation_failed",
        severity: "high",
        title: `Acción de SONIA falló al ejecutarse (${r.kind})`,
        detail: `Un borrador aprobado (${r.kind}) falló al ejecutarse.`,
        ownerUserId: r.reviewedById ?? null,
        clientId: null,
        createdAt: r.createdAt.toISOString(),
        ageMs: ageOf(r.createdAt, now),
        link: `/admin/nv-ia/drafts/${r.id}`,
        why: "La automatización se intentó y falló; requiere intervención.",
        soniaWillDo: null,
        needsFromMe: "Revisar el error y reintentar o resolver a mano."
      });
    }
  }
  return out;
}

export type AiRunRow = { id: string; status: string; taskId: string; summary: string | null; error: string | null; createdAt: Date };
export function fromAiRuns(rows: AiRunRow[], now: Date): ExceptionItem[] {
  const out: ExceptionItem[] = [];
  for (const r of rows) {
    if (r.status === "REQUIRES_HUMAN") {
      const age = ageOf(r.createdAt, now);
      out.push({
        id: `ai_run:${r.id}`,
        dedupeKey: `requires_human:task:${r.taskId}`,
        source: "ai_run",
        kind: age > 2 * DAY ? "sla_breached" : "message_unresolved",
        severity: age > 2 * DAY ? "high" : "medium",
        title: "SONIA necesita ayuda para continuar",
        detail: (r.summary ?? "SONIA pausó la tarea a la espera de una decisión humana.").slice(0, 200),
        ownerUserId: null,
        clientId: null,
        createdAt: r.createdAt.toISOString(),
        ageMs: age,
        link: `/tareas?task=${r.taskId}`,
        why: "SONIA pidió intervención humana para poder seguir.",
        soniaWillDo: "Retomará la tarea automáticamente cuando respondas.",
        needsFromMe: "Responder en la tarea para que SONIA continúe."
      });
    } else if (r.status === "FAILED") {
      out.push({
        id: `ai_run:${r.id}`,
        dedupeKey: `failed:task:${r.taskId}`,
        source: "ai_run",
        kind: "automation_failed",
        severity: "high",
        title: "Una ejecución de SONIA falló",
        detail: (r.error ?? "Error desconocido").slice(0, 200),
        ownerUserId: null,
        clientId: null,
        createdAt: r.createdAt.toISOString(),
        ageMs: ageOf(r.createdAt, now),
        link: `/tareas?task=${r.taskId}`,
        why: "La automatización terminó con error.",
        soniaWillDo: null,
        needsFromMe: "Revisar el error y decidir si reintentar."
      });
    }
  }
  return out;
}

export type InvoiceRow = { id: string; number: string | null; status: string; totalCents: number; paidCents: number; dueDate: Date | null; clientId: string | null; clientName?: string | null };
export function fromInvoices(rows: InvoiceRow[], now: Date): ExceptionItem[] {
  const out: ExceptionItem[] = [];
  for (const r of rows) {
    const outstanding = Math.max(0, r.totalCents - r.paidCents);
    const overdue = r.status === "ISSUED" && outstanding > 0 && !!r.dueDate && r.dueDate.getTime() < now.getTime();
    if (!overdue) continue;
    const daysLate = Math.floor(ageOf(r.dueDate!, now) / DAY);
    const band = amountBandFromCents(outstanding);
    // Cobros: severidad por IMPACTO = mora × importe (la deuda que envejece y es
    // grande es lo más grave), no por edad sola. Un importe "alto" sube un tramo.
    let sev: Severity = daysLate > 30 ? "high" : daysLate > 7 ? "medium" : "low";
    if (band === "alto" && daysLate > 7) sev = "critical";
    else if (band === "alto") sev = "high";
    else if (band === "medio" && daysLate > 30) sev = "critical";
    out.push({
      id: `invoice:${r.id}`,
      dedupeKey: `billing:invoice:${r.id}`,
      source: "invoice",
      kind: "billing_problem",
      severity: sev,
      title: `Factura vencida sin cobrar${r.number ? ` (${r.number})` : ""}`,
      detail: `Vencida hace ${daysLate} día(s)${r.clientName ? ` · ${r.clientName}` : ""}.`,
      ownerUserId: null,
      clientId: r.clientId,
      clientName: r.clientName ?? null,
      amountBand: band,
      createdAt: r.dueDate!.toISOString(),
      ageMs: ageOf(r.dueDate!, now),
      link: `/facturacion?invoice=${r.id}`,
      why: "La factura pasó su fecha de vencimiento con importe pendiente.",
      soniaWillDo: "Puede preparar un recordatorio de cobro (borrador) para tu aprobación.",
      needsFromMe: "Reclamar el cobro o registrar el pago."
    });
  }
  return out;
}

export type TaskRow = { id: string; title: string; dueDate: Date | null; completedAt: Date | null; clientId: string | null; clientName?: string | null };
export function fromTasks(rows: TaskRow[], now: Date): ExceptionItem[] {
  const out: ExceptionItem[] = [];
  for (const r of rows) {
    if (r.completedAt || !r.dueDate || r.dueDate.getTime() >= now.getTime()) continue;
    const daysLate = Math.floor(ageOf(r.dueDate, now) / DAY);
    // Tareas: severidad por RECENCIA (accionabilidad), no por edad infinita. Una
    // tarea recién vencida es recuperable y urgente; una muy antigua es histórica
    // (ruido a limpiar, no urgencia). Si es de un cliente, sube un tramo.
    let sev: Severity = daysLate <= 7 ? "high" : daysLate <= 30 ? "medium" : "low";
    if (r.clientId && sev !== "high") sev = sev === "low" ? "medium" : "high";
    // "Qué hará SONIA": propone un siguiente paso REAL (borrador), nunca "nada".
    const willDo = daysLate > 30
      ? "Puede proponer cerrarla o reprogramarla en un lote de limpieza para tu OK."
      : "Puede proponer una nueva fecha y recordártela; reasignar requiere tu OK.";
    out.push({
      id: `task:${r.id}`,
      dedupeKey: `task_blocked:task:${r.id}`,
      source: "task",
      kind: "task_blocked",
      severity: sev,
      title: `Tarea vencida sin cerrar: ${r.title}`,
      detail: `Vencida hace ${daysLate} día(s) y sigue abierta${r.clientName ? ` · ${r.clientName}` : ""}.`,
      ownerUserId: null,
      clientId: r.clientId,
      clientName: r.clientName ?? null,
      createdAt: r.dueDate.toISOString(),
      ageMs: ageOf(r.dueDate, now),
      link: `/tareas?task=${r.id}`,
      why: "La tarea superó su vencimiento sin completarse.",
      soniaWillDo: willDo,
      needsFromMe: "Reprogramar, delegar o completar la tarea."
    });
  }
  return out;
}

// ── Deduplicación + orden ────────────────────────────────────────────────────

/** Deduplica por `dedupeKey` conservando el ítem de MAYOR severidad (y más antiguo). */
export function dedupe(items: ExceptionItem[]): ExceptionItem[] {
  const best = new Map<string, ExceptionItem>();
  for (const it of items) {
    const cur = best.get(it.dedupeKey);
    if (!cur || SEVERITY_RANK[it.severity] > SEVERITY_RANK[cur.severity] || (SEVERITY_RANK[it.severity] === SEVERITY_RANK[cur.severity] && it.ageMs > cur.ageMs)) {
      best.set(it.dedupeKey, it);
    }
  }
  return [...best.values()];
}

/** Orden: severidad desc, luego más antiguo primero. */
export function sortExceptions(items: ExceptionItem[]): ExceptionItem[] {
  return items.slice().sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.ageMs - a.ageMs);
}

export type ExceptionFilters = { source?: ExceptionSource; kind?: ExceptionKind; severity?: Severity; clientId?: string };

export const EXCEPTION_SOURCES: ExceptionSource[] = ["ai_draft", "ai_run", "invoice", "task", "lead_inbox", "cron"];
export const EXCEPTION_KINDS: ExceptionKind[] = ["approval_pending", "automation_failed", "sla_breached", "billing_problem", "message_unresolved", "task_blocked"];
export const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

/** Coacciona filtros de query: valores no reconocidos → undefined (sin filtro),
 *  para que un typo muestre la bandeja completa (dirección segura) y no vacía. */
export function coerceFilters(raw: { source?: string | null; kind?: string | null; severity?: string | null; clientId?: string | null }): ExceptionFilters {
  const one = <T extends string>(v: string | null | undefined, allowed: readonly T[]): T | undefined =>
    v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
  return {
    source: one(raw.source, EXCEPTION_SOURCES),
    kind: one(raw.kind, EXCEPTION_KINDS),
    severity: one(raw.severity, SEVERITIES),
    clientId: (raw.clientId ?? "").trim() || undefined
  };
}
export function applyFilters(items: ExceptionItem[], f: ExceptionFilters): ExceptionItem[] {
  return items.filter(
    (it) =>
      (!f.source || it.source === f.source) &&
      (!f.kind || it.kind === f.kind) &&
      (!f.severity || it.severity === f.severity) &&
      (!f.clientId || it.clientId === f.clientId)
  );
}

/** Resumen por severidad para badges. */
export function summarize(items: ExceptionItem[]): Record<Severity, number> & { total: number } {
  const s = { critical: 0, high: 0, medium: 0, low: 0, total: items.length };
  for (const it of items) s[it.severity]++;
  return s;
}
