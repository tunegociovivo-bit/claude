/**
 * Autonomía de SONIA A0–A4 y política DETERMINISTA server-side (FASE 4a).
 *
 * Principio rector: **el nivel efectivo lo decide el SERVIDOR**, nunca el modelo.
 * Aunque una acción propuesta traiga un nivel/etiqueta "safe", aquí se recalcula
 * a partir de la política + la clasificación de riesgo del servidor (reutilizando
 * el sensitive-tool gate de Fase 1). El modelo NO puede autoelevarse.
 *
 * Niveles (por ACCIÓN, no por agente global):
 *   A0 observar        — solo mira/registra; jamás actúa.
 *   A1 recomendar      — sugiere; el humano decide.
 *   A2 preparar borrador— crea un borrador (AiDraft) para revisión.
 *   A3 ejecutar reversible con límites — acciones reversibles dentro de topes
 *      (monetarios/volumen) y con idempotencia; nada sensible.
 *   A4 ejecutar sensible SOLO bajo política + aprobación previa — dinero,
 *      mensajería, permisos, Make DELETE, auto-merge… (los del gate de Fase 1).
 */
import { toolDanger } from "@/lib/ai/nv-ia/tool-gate";

export type AutonomyLevel = "A0" | "A1" | "A2" | "A3" | "A4";
export const AUTONOMY_ORDER: AutonomyLevel[] = ["A0", "A1", "A2", "A3", "A4"];

export const AUTONOMY_LEVELS: Record<AutonomyLevel, { label: string; description: string }> = {
  A0: { label: "Observar", description: "Solo observa y registra; no actúa." },
  A1: { label: "Recomendar", description: "Sugiere; decide el humano." },
  A2: { label: "Preparar borrador", description: "Crea un borrador para revisión humana." },
  A3: { label: "Ejecutar reversible", description: "Ejecuta acciones reversibles dentro de límites, con idempotencia." },
  A4: { label: "Ejecutar sensible", description: "Solo bajo política + aprobación previa (dinero/mensajería/permisos)." }
};

export type ActionRisk = "none" | "low" | "medium" | "high" | "sensitive";

/** Descriptor de una acción propuesta. `risk` de aquí es una PISTA; el servidor
 *  puede endurecerlo (sensitive) vía el tool-gate. */
export type ActionDescriptor = {
  action: string; // nombre de tool/acción, p.ej. "send_whatsapp_message", "create_task"
  input?: unknown; // args (para make_raw_api el método, etc.)
  risk?: ActionRisk; // pista opcional; NO decide por sí sola
  amountCents?: number; // importe implicado (acciones de dinero)
  volume?: number; // nº de destinatarios/items (acciones masivas)
  clientId?: string | null;
};

export type ActionContext = {
  workspaceId: string;
  isAdmin: boolean;
  hasPriorApproval?: boolean; // ya existe aprobación humana para esta acción
};

export type AutonomyPolicy = {
  killSwitch: boolean; // desactiva TODA autonomía (todo cae a A0)
  ceilingByRisk: Record<ActionRisk, AutonomyLevel>; // techo por riesgo (server)
  moneyLimitCents: number; // tope reversible sin aprobación
  volumeLimit: number; // tope de volumen sin aprobación
  allowlist: string[]; // acciones que pueden automatizarse (fuera → solo A0/A1)
};

export const DEFAULT_AUTONOMY_POLICY: AutonomyPolicy = {
  killSwitch: false,
  // Por defecto conservador: nada sensible se auto-ejecuta; lo demás como mucho A3.
  ceilingByRisk: { none: "A3", low: "A3", medium: "A2", high: "A2", sensitive: "A4" },
  moneyLimitCents: 0, // 0 = ninguna acción de dinero sin aprobación
  volumeLimit: 25,
  allowlist: []
};

/**
 * Merge SANEADO de una política parcial (workspace.settings) sobre el default.
 * Números finitos y ≥0; niveles válidos; allowlist array de strings. Cualquier
 * valor inválido cae al default (determinismo: nada de NaN/negativos).
 */
function safeNum(v: unknown, def: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : def;
}
function safeLevel(v: unknown, def: AutonomyLevel): AutonomyLevel {
  return typeof v === "string" && (AUTONOMY_ORDER as string[]).includes(v) ? (v as AutonomyLevel) : def;
}
export function mergeAutonomyPolicy(partial?: Partial<AutonomyPolicy> | null): AutonomyPolicy {
  const d = DEFAULT_AUTONOMY_POLICY;
  const p = (partial ?? {}) as any;
  const ceil = (p.ceilingByRisk ?? {}) as Record<string, unknown>;
  return {
    killSwitch: p.killSwitch === true,
    moneyLimitCents: safeNum(p.moneyLimitCents, d.moneyLimitCents),
    volumeLimit: safeNum(p.volumeLimit, d.volumeLimit),
    allowlist: Array.isArray(p.allowlist) ? p.allowlist.filter((x: unknown) => typeof x === "string") : d.allowlist,
    ceilingByRisk: {
      none: safeLevel(ceil.none, d.ceilingByRisk.none),
      low: safeLevel(ceil.low, d.ceilingByRisk.low),
      medium: safeLevel(ceil.medium, d.ceilingByRisk.medium),
      high: safeLevel(ceil.high, d.ceilingByRisk.high),
      // 'sensitive' NUNCA se puede relajar por config: siempre A4.
      sensitive: "A4"
    }
  };
}

export type AutonomyDecision = {
  action: string;
  grantedLevel: AutonomyLevel; // nivel EFECTIVO que concede el servidor
  effectiveRisk: ActionRisk;
  allowed: boolean; // ¿puede ejecutarse de forma autónoma AHORA?
  requiresApproval: boolean; // ¿necesita aprobación humana previa?
  reasons: string[]; // explicación (auditable)
  idempotencyKey: string; // clave determinista para evitar duplicados
};

const clamp = (lvl: AutonomyLevel, ceil: AutonomyLevel): AutonomyLevel =>
  AUTONOMY_ORDER.indexOf(lvl) <= AUTONOMY_ORDER.indexOf(ceil) ? lvl : ceil;

/** Clave de idempotencia determinista (sin depender de reloj/aleatorio). */
export function idempotencyKeyFor(a: ActionDescriptor, ctx: ActionContext): string {
  const amount = a.amountCents ?? 0;
  const target = a.clientId ?? "";
  return `${ctx.workspaceId}:${a.action}:${target}:${amount}:${a.volume ?? 0}`;
}

/**
 * Riesgo EFECTIVO del servidor: si el sensitive-tool gate (Fase 1) lo marca
 * peligroso → "sensitive" (dinero/mensajería/Make mutante). Si no, usa la pista
 * o "low" por defecto. Nunca lo rebaja por debajo de lo que dice el gate.
 */
export function effectiveRisk(a: ActionDescriptor): ActionRisk {
  if (toolDanger(a.action, a.input) !== null) return "sensitive";
  const hint = a.risk ?? "low";
  return hint;
}

/**
 * Resuelve el nivel de autonomía EFECTIVO y si requiere aprobación. Determinista.
 * El modelo no interviene: solo la política + la clasificación del servidor.
 */
export function resolveAutonomy(a: ActionDescriptor, ctx: ActionContext, policy: AutonomyPolicy = DEFAULT_AUTONOMY_POLICY): AutonomyDecision {
  const reasons: string[] = [];
  const risk = effectiveRisk(a);
  const idempotencyKey = idempotencyKeyFor(a, ctx);

  // Kill-switch global → todo a A0 (solo observar).
  if (policy.killSwitch) {
    return { action: a.action, grantedLevel: "A0", effectiveRisk: risk, allowed: false, requiresApproval: false, reasons: ["Kill-switch de autonomía activo: solo observación."], idempotencyKey };
  }

  // Techo por riesgo (server).
  let level: AutonomyLevel = policy.ceilingByRisk[risk] ?? "A2";
  reasons.push(`Riesgo del servidor: ${risk} → techo ${level}.`);

  // Fuera de la allowlist: como mucho A1 (recomendar). Nunca ejecuta.
  if (!policy.allowlist.includes(a.action)) {
    level = clamp(level, "A1");
    reasons.push("Acción no está en la allowlist de automatización → máximo A1 (recomendar).");
  }

  let requiresApproval = false;

  // Sensible (gate de Fase 1) → A4 y SIEMPRE aprobación previa; jamás autónomo.
  if (risk === "sensitive") {
    level = "A4";
    requiresApproval = true;
    reasons.push("Acción sensible (gate de Fase 1: dinero/mensajería/Make mutante): A4, requiere aprobación previa.");
  }

  // Límite monetario: por encima → aprobación.
  if ((a.amountCents ?? 0) > policy.moneyLimitCents) {
    requiresApproval = true;
    reasons.push(`Importe ${(a.amountCents ?? 0)} > límite ${policy.moneyLimitCents} → requiere aprobación.`);
  }
  // Límite de volumen: por encima → aprobación.
  if ((a.volume ?? 0) > policy.volumeLimit) {
    requiresApproval = true;
    reasons.push(`Volumen ${(a.volume ?? 0)} > límite ${policy.volumeLimit} → requiere aprobación.`);
  }

  // Con aprobación previa concedida, una acción que la requería puede ejecutarse.
  const approvedNow = requiresApproval && ctx.hasPriorApproval === true;
  if (approvedNow) reasons.push("Aprobación previa presente: la acción puede ejecutarse bajo política.");

  // ¿Ejecuta autónomamente? Solo si nivel >= A3 y (no requiere aprobación, o ya la tiene).
  const canExecute = AUTONOMY_ORDER.indexOf(level) >= AUTONOMY_ORDER.indexOf("A3") && (!requiresApproval || approvedNow);

  return {
    action: a.action,
    grantedLevel: level,
    effectiveRisk: risk,
    allowed: canExecute,
    requiresApproval,
    reasons,
    idempotencyKey
  };
}
