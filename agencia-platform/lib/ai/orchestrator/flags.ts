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
