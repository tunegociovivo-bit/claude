/**
 * Flags del orquestador (Slice 2c). TODO OFF por defecto → runner actual intacto.
 */
export function orchestratorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.AI_RUN_ORCHESTRATOR ?? "").trim().toLowerCase() === "on";
}

/** Modo del orquestador: "shadow" (por defecto cuando está on) solo simula y
 *  registra; "live" reservado para el futuro (no ejecuta acciones externas aún). */
export function orchestratorMode(env: NodeJS.ProcessEnv = process.env): "shadow" | "live" {
  return (env.AI_RUN_ORCHESTRATOR ?? "").trim().toLowerCase() === "live" ? "live" : "shadow";
}

/** Registro en SHADOW de la decisión de autonomía en el runner (no bloquea, no
 *  ejecuta): solo anota qué haría `resolveAutonomy`. Off por defecto. */
export function autonomyShadowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.HUB_AUTONOMY_SHADOW ?? "").trim().toLowerCase() === "on";
}

/** Enrutado multi-modelo (adaptadores). Off por defecto. En shadow SIMULA; en modo
 *  live (orchestratorMode==="live") hace la llamada REAL de modelo. */
export function multiModelEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.AI_MULTIMODEL ?? "").trim().toLowerCase() === "on";
}

/** KILL-SWITCH operativo: si está ON, el scheduler cancela (parada segura) cualquier
 *  run que procese. Opt-in y explícito; OFF por defecto (no mata nada). */
export function autonomyKillSwitch(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.HUB_AUTONOMY_KILL ?? "").trim().toLowerCase() === "on";
}
