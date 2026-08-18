/**
 * Piloto automático — lógica PURA de planificación. Decide, según la política de la ficha, qué
 * acciones INTERNAS puede auto-avanzar el scheduler (respetando modo, kill switch, quiet hours,
 * límite diario, confianza mínima y módulos permitidos). Las acciones EXTERNAS nunca se ejecutan:
 * como mucho se llevan a needs_approval. Sin red ni Prisma.
 */
import { autopilotPlan, type ActionStatus, type AutopilotMode, type ActionCommand } from "./actions";

export type AutopilotPolicy = {
  mode: AutopilotMode;
  dailyLimit: number;
  quietStart?: number | null;
  quietEnd?: number | null;
  minConfidence: number;
  allowedModules?: string[] | null; // null = todos los internos
  killSwitch: boolean;
  executedToday: number;
  executedDate?: string | null; // YYYY-MM-DD
};

export type AutopilotAction = { id: string; status: ActionStatus; external: boolean; module: string; confidence: number };

/** ¿Estamos en horas de silencio? Soporta rango con vuelta de medianoche (p.ej. 22→7). */
export function isQuietHour(hour: number, quietStart?: number | null, quietEnd?: number | null): boolean {
  if (quietStart == null || quietEnd == null) return false;
  if (quietStart === quietEnd) return false;
  if (quietStart < quietEnd) return hour >= quietStart && hour < quietEnd;
  return hour >= quietStart || hour < quietEnd; // cruza medianoche
}

/** Presupuesto diario restante (se reinicia si cambia el día). */
export function remainingDailyBudget(policy: AutopilotPolicy, todayISO: string): number {
  const used = policy.executedDate === todayISO ? policy.executedToday : 0;
  return Math.max(0, policy.dailyLimit - used);
}

export type AutopilotPlan = {
  active: boolean;
  reason?: string;
  toAdvance: { actionId: string; commands: ActionCommand[]; reason: string }[];
  skipped: { actionId: string; reason: string }[];
};

/**
 * Planifica el avance automático. Devuelve la lista de acciones internas a auto-avanzar (acotada por
 * el presupuesto diario) y las descartadas con su motivo. NUNCA incluye ejecución de externas.
 */
export function planAutopilot(input: { policy: AutopilotPolicy; actions: AutopilotAction[]; hour: number; todayISO: string }): AutopilotPlan {
  const { policy, actions, hour, todayISO } = input;
  if (policy.killSwitch) return { active: false, reason: "kill_switch", toAdvance: [], skipped: [] };
  if (policy.mode === "suggest_only") return { active: false, reason: "suggest_only", toAdvance: [], skipped: [] };
  if (isQuietHour(hour, policy.quietStart, policy.quietEnd)) return { active: false, reason: "quiet_hours", toAdvance: [], skipped: [] };

  let budget = remainingDailyBudget(policy, todayISO);
  const toAdvance: AutopilotPlan["toAdvance"] = [];
  const skipped: AutopilotPlan["skipped"] = [];
  const allowed = policy.allowedModules;

  for (const a of actions) {
    if (a.external) {
      // Externas: como mucho pedir aprobación (no cuenta como ejecución ni consume presupuesto).
      const cmds = autopilotPlan({ status: a.status, external: true }, policy.mode);
      if (cmds.length) toAdvance.push({ actionId: a.id, commands: cmds, reason: "external→needs_approval" });
      continue;
    }
    if (allowed && allowed.length && !allowed.includes(a.module)) { skipped.push({ actionId: a.id, reason: "module_not_allowed" }); continue; }
    if (a.confidence < policy.minConfidence) { skipped.push({ actionId: a.id, reason: `confidence<${policy.minConfidence}` }); continue; }
    const cmds = autopilotPlan({ status: a.status, external: false }, policy.mode);
    if (!cmds.length) continue;
    const willExecute = cmds.includes("execute");
    if (willExecute && budget <= 0) { skipped.push({ actionId: a.id, reason: "daily_limit" }); continue; }
    if (willExecute) budget -= 1;
    toAdvance.push({ actionId: a.id, commands: cmds, reason: `autopilot:${policy.mode}` });
  }
  return { active: true, toAdvance, skipped };
}
