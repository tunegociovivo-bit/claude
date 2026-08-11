/**
 * Cableado de A0–A4 en SHADOW (Slice 2c) — puro. Combina:
 *   - `resolveAutonomy` (decisión server-side, Fase 4a),
 *   - el almacén de aprobaciones reutilizables (`evaluateApproval`),
 *   - `dryRun` (simulación, executed:false),
 * y produce un registro auditable de "qué haría" SIN ejecutar nada externo.
 *
 * A4 / acciones sensibles: SIEMPRE requieren política + aprobación previa; aquí
 * la aprobación se resuelve consultando aprobaciones vivas (nunca implícita).
 */
import { resolveAutonomy, effectiveRisk, type ActionDescriptor, type ActionContext, type AutonomyPolicy, DEFAULT_AUTONOMY_POLICY } from "@/lib/ai/autonomy/policy";
import { dryRun, type DryRunResult } from "@/lib/ai/autonomy/adapters";
import { evaluateApproval, type ApprovalRecord } from "./approvals";

export type ShadowRecord = {
  action: string;
  executed: false; // invariante duro en shadow
  external: boolean; // ¿tocaría un sistema externo?
  grantedLevel: string;
  effectiveRisk: string;
  requiresApproval: boolean;
  approvalUsed: string | null; // id de la aprobación que lo cubriría (o null)
  allowed: boolean; // ¿procedería de forma autónoma (en modo live futuro)?
  wouldDo: string;
  reasons: string[];
  idempotencyKey: string;
};

/**
 * Evalúa una acción en shadow. `approvals` son las aprobaciones vivas del
 * workspace (las trae la capa de persistencia). Determinista dado `now`.
 */
export function shadowEvaluate(
  a: ActionDescriptor,
  ctx: Omit<ActionContext, "hasPriorApproval">,
  approvals: ApprovalRecord[],
  now: Date,
  policy: AutonomyPolicy = DEFAULT_AUTONOMY_POLICY
): ShadowRecord {
  const risk = effectiveRisk(a);
  // Aprobación previa: solo relevante para acciones que la requieren. Se resuelve
  // contra el almacén (jamás implícita).
  const appr = evaluateApproval(
    approvals,
    { action: a.action, scope: a.clientId ?? null, amountCents: a.amountCents ?? null, volume: a.volume ?? null },
    now
  );
  const fullCtx: ActionContext = { ...ctx, hasPriorApproval: appr.approved };
  const decision = resolveAutonomy(a, fullCtx, policy);
  const sim: DryRunResult = dryRun(a, fullCtx, policy);

  return {
    action: a.action,
    executed: false,
    external: sim.external,
    grantedLevel: decision.grantedLevel,
    effectiveRisk: risk,
    requiresApproval: decision.requiresApproval,
    approvalUsed: decision.requiresApproval && appr.approved ? appr.matchedId : null,
    allowed: decision.allowed,
    wouldDo: sim.wouldDo,
    reasons: decision.reasons,
    idempotencyKey: decision.idempotencyKey
  };
}
