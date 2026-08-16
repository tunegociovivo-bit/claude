/**
 * Cola de acciones del GMB Hub — lógica PURA (transiciones, prioridad, reglas de aprobación y
 * autonomía). Sin red ni Prisma: la capa de API la usa para decidir de forma determinista.
 *
 * Principio de seguridad: una acción con efecto EXTERNO sensible (`external`) SIEMPRE requiere
 * aprobación humana explícita; el piloto automático nunca la ejecuta sola, sea cual sea el modo.
 */

export type ActionStatus = "suggested" | "prepared" | "needs_approval" | "approved" | "executing" | "done" | "dismissed" | "error";
export type ActionCommand = "prepare" | "request_approval" | "approve" | "execute" | "complete" | "fail" | "dismiss" | "reopen";
export type AutopilotMode = "suggest_only" | "prepare_drafts" | "execute_safe";

/** Prioridad para ordenar la cola: más impacto y confianza, menos esfuerzo → mayor prioridad. */
export function computeActionPriority(a: { impact: number; effort: number; confidence: number }): number {
  const impact = Math.max(0, Math.min(a.impact, 100));
  const confidence = Math.max(0, Math.min(a.confidence, 100));
  const effort = Math.max(1, Math.min(a.effort, 100)); // evita /0; esfuerzo 0 se trata como 1
  return Math.round(((impact * (confidence / 100)) / effort) * 100);
}

// Transiciones permitidas (grafo de estados). El resto se rechaza.
const TRANSITIONS: Record<ActionCommand, { from: ActionStatus[]; to: ActionStatus }> = {
  prepare: { from: ["suggested"], to: "prepared" },
  request_approval: { from: ["suggested", "prepared"], to: "needs_approval" },
  approve: { from: ["needs_approval", "prepared", "suggested"], to: "approved" },
  execute: { from: ["approved"], to: "executing" },
  complete: { from: ["executing"], to: "done" },
  fail: { from: ["executing", "approved"], to: "error" },
  dismiss: { from: ["suggested", "prepared", "needs_approval", "approved", "error"], to: "dismissed" },
  reopen: { from: ["dismissed", "error"], to: "suggested" }
};

export type TransitionResult = { ok: boolean; next?: ActionStatus; error?: string };

/**
 * Valida y calcula la transición. Reglas duras:
 *  - una acción EXTERNA no puede pasar a `approved` sin pasar por `needs_approval` con aprobador,
 *  - `approve` de una acción externa exige `actorId` (aprobación humana) y `requiresApproval`.
 */
export function computeActionTransition(
  action: { status: ActionStatus; external: boolean; requiresApproval: boolean },
  command: ActionCommand,
  ctx: { actorId?: string | null } = {}
): TransitionResult {
  const rule = TRANSITIONS[command];
  if (!rule) return { ok: false, error: `comando desconocido: ${command}` };
  if (!rule.from.includes(action.status)) return { ok: false, error: `transición inválida ${action.status} → ${command}` };
  if (command === "approve") {
    if (!ctx.actorId) return { ok: false, error: "la aprobación requiere un actor humano" };
    // Externa sensible: solo se aprueba desde needs_approval (no atajos).
    if (action.external && action.status !== "needs_approval") return { ok: false, error: "una acción externa debe pasar por needs_approval" };
  }
  if (command === "execute" && action.external && action.status !== "approved") {
    return { ok: false, error: "una acción externa solo se ejecuta tras aprobación" };
  }
  return { ok: true, next: rule.to };
}

/**
 * Qué puede hacer el PILOTO AUTOMÁTICO sin humano, según el modo de la ficha:
 *  - suggest_only   → nada (solo deja la acción sugerida),
 *  - prepare_drafts → prepara borradores de acciones NO externas (suggested → prepared),
 *  - execute_safe   → prepara y ejecuta acciones internas seguras (no externas); las externas
 *                     se detienen en needs_approval.
 * Devuelve la secuencia de comandos que el autopilot puede aplicar ahora (puede ser vacía).
 */
export function autopilotPlan(
  action: { status: ActionStatus; external: boolean },
  mode: AutopilotMode
): ActionCommand[] {
  if (action.external) {
    // Externas: como mucho, llevarlas a needs_approval; nunca aprobar/ejecutar solo.
    return action.status === "suggested" || action.status === "prepared" ? ["request_approval"] : [];
  }
  if (mode === "suggest_only") return [];
  if (mode === "prepare_drafts") return action.status === "suggested" ? ["prepare"] : [];
  // execute_safe: internas seguras hasta done.
  if (mode === "execute_safe") {
    switch (action.status) {
      case "suggested": return ["prepare", "approve", "execute", "complete"];
      case "prepared": return ["approve", "execute", "complete"];
      case "approved": return ["execute", "complete"];
      case "executing": return ["complete"];
      default: return [];
    }
  }
  return [];
}

/** Estados que cuentan como "abiertos" (pendientes de trabajar) para contadores/orden. */
export const OPEN_ACTION_STATUSES: ActionStatus[] = ["suggested", "prepared", "needs_approval", "approved", "executing"];
