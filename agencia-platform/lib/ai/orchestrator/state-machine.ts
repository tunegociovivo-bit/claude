/**
 * Máquina de estados EXPLÍCITA del orquestador resiliente de SONIA (Slice 2c).
 * Pura y determinista (sin BD, sin reloj). Las transiciones válidas se declaran
 * una sola vez aquí; la capa de persistencia (store.ts) las valida antes de
 * escribir de forma concurrency-safe.
 *
 * NO cambia el enum actual `AiAgentRunStatus`; es un plano de control aditivo
 * que corre en SHADOW por defecto (flag off → runner actual intacto).
 */

export const ORCH_STATES = [
  "queued",
  "planning",
  "executing",
  "verifying",
  "diagnosing",
  "decomposing",
  "waiting_backoff",
  "completed",
  "materially_blocked",
  "approval_required",
  "budget_exhausted",
  "cancelled"
] as const;
export type OrchState = (typeof ORCH_STATES)[number];

/** Estados terminales: no admiten más transiciones. */
export const TERMINAL_STATES: ReadonlySet<OrchState> = new Set<OrchState>([
  "completed",
  "materially_blocked",
  "budget_exhausted",
  "cancelled"
]);

/**
 * Transiciones permitidas. Todo lo no listado es inválido (rechazado en el store).
 * `cancelled` es alcanzable desde cualquier estado NO terminal (cancelación
 * externa), se maneja aparte en `canTransition`.
 */
const ALLOWED: Record<OrchState, readonly OrchState[]> = {
  queued: ["planning", "cancelled"],
  planning: ["executing", "decomposing", "materially_blocked", "approval_required", "cancelled"],
  // `executing` puede concluir PRE-VUELO que no puede proseguir (sin proveedor sano,
  // breaker abierto, o presupuesto ya agotado a la entrada) → estados de parada/escala
  // sin pasar por un fallo de intento. Todos válidos y consistentes con `diagnosing`.
  executing: ["verifying", "diagnosing", "waiting_backoff", "decomposing", "materially_blocked", "budget_exhausted", "approval_required", "cancelled"],
  verifying: ["completed", "diagnosing", "cancelled"],
  diagnosing: ["waiting_backoff", "decomposing", "materially_blocked", "approval_required", "budget_exhausted", "cancelled"],
  decomposing: ["planning", "executing", "materially_blocked", "cancelled"],
  waiting_backoff: ["executing", "planning", "budget_exhausted", "cancelled"],
  // terminales
  completed: [],
  materially_blocked: [],
  approval_required: ["executing", "planning", "materially_blocked", "cancelled"], // al aprobar/rechazar
  budget_exhausted: [],
  cancelled: []
};

export function isTerminal(s: OrchState): boolean {
  return TERMINAL_STATES.has(s);
}

export function isOrchState(s: unknown): s is OrchState {
  return typeof s === "string" && (ORCH_STATES as readonly string[]).includes(s);
}

/** ¿Se puede pasar de `from` a `to`? Determinista, sin excepciones. */
export function canTransition(from: OrchState, to: OrchState): boolean {
  if (from === to) return false; // no self-loops (idempotencia se maneja arriba)
  if (isTerminal(from)) return false; // de un terminal no se sale
  if (to === "cancelled") return true; // cancelación desde cualquier no-terminal
  return (ALLOWED[from] ?? []).includes(to);
}

/** Lista de destinos válidos desde `from` (para introspección/tests/UI). */
export function nextStates(from: OrchState): OrchState[] {
  if (isTerminal(from)) return [];
  const base = new Set<OrchState>(ALLOWED[from] ?? []);
  base.add("cancelled");
  base.delete(from);
  return [...base];
}

/** Motivo legible por estado terminal (para el panel de progreso). */
export const STATE_LABEL: Record<OrchState, string> = {
  queued: "En cola",
  planning: "Planificando",
  executing: "Ejecutando",
  verifying: "Verificando",
  diagnosing: "Diagnosticando",
  decomposing: "Descomponiendo",
  waiting_backoff: "Esperando reintento",
  completed: "Completado",
  materially_blocked: "Bloqueado (requiere decisión)",
  approval_required: "Requiere aprobación",
  budget_exhausted: "Presupuesto agotado",
  cancelled: "Cancelado"
};
