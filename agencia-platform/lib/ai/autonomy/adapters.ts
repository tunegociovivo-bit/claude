/**
 * Adaptadores DRY-RUN / SHADOW (FASE 4a).
 *
 * NUNCA ejecutan una acción externa real. Dada una acción propuesta, devuelven
 * QUÉ HARÍAN y si la política la bloquea. WhatsApp/email/reembolsos/gasto/Make
 * DELETE siguen bloqueados: aquí solo se SIMULA (shadow) para poder probar el
 * motor sin efectos. La ejecución real quedará para fases posteriores y solo por
 * las vías ya existentes (AiDraft + aprobación).
 */
import { resolveAutonomy, effectiveRisk, type ActionDescriptor, type ActionContext, type AutonomyPolicy, DEFAULT_AUTONOMY_POLICY } from "./policy";

export type DryRunResult = {
  action: string;
  mode: "dry-run";
  executed: false; // invariante: en este slice jamás se ejecuta de verdad
  external: boolean; // ¿tocaría un sistema externo (WhatsApp/Stripe/Make/…)?
  wouldDo: string; // descripción legible de lo que HARÍA
  blocked: boolean; // ¿la política lo impide ahora?
  blockedReason?: string;
  grantedLevel: string;
  requiresApproval: boolean;
  idempotencyKey: string;
};

function describe(a: ActionDescriptor): string {
  const target = a.clientId ? ` (cliente ${a.clientId})` : "";
  const amount = a.amountCents ? ` por ${(a.amountCents / 100).toFixed(2)} €` : "";
  const vol = a.volume ? ` a ${a.volume} destinatarios` : "";
  return `Simularía "${a.action}"${target}${amount}${vol}. (dry-run: sin efecto real)`;
}

/**
 * Simula una acción sin ejecutarla. `external=true` cuando la acción es sensible
 * (gate de Fase 1) — esas SIEMPRE quedan bloqueadas salvo aprobación previa.
 */
export function dryRun(a: ActionDescriptor, ctx: ActionContext, policy: AutonomyPolicy = DEFAULT_AUTONOMY_POLICY): DryRunResult {
  const decision = resolveAutonomy(a, ctx, policy);
  const external = effectiveRisk(a) === "sensitive";
  const blocked = !decision.allowed;
  return {
    action: a.action,
    mode: "dry-run",
    executed: false,
    external,
    wouldDo: describe(a),
    blocked,
    blockedReason: blocked
      ? decision.requiresApproval
        ? "Requiere aprobación previa (no concedida)."
        : `Nivel concedido ${decision.grantedLevel}: no autónomo.`
      : undefined,
    grantedLevel: decision.grantedLevel,
    requiresApproval: decision.requiresApproval,
    idempotencyKey: decision.idempotencyKey
  };
}
