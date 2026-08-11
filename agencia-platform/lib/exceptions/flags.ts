/**
 * Kill-switch de la bandeja de excepciones (FASE 4a). Aditivo: por defecto
 * ACTIVO (endpoint nuevo de solo lectura). `HUB_EXCEPTIONS=off` → 404 (la UI
 * actual no depende de él).
 */
export function exceptionsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.HUB_EXCEPTIONS ?? "").trim().toLowerCase() !== "off";
}

/**
 * Persistencia server-side de acciones sobre excepciones (Slice 2b). Por
 * defecto DESACTIVADA: la UI sigue usando localStorage (comportamiento actual).
 * `HUB_EXCEPTIONS_ACTIONS=on` → el endpoint de acciones responde y el inbox
 * filtra las excepciones archivadas/ignoradas/pospuestas vivas.
 */
export function exceptionActionsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.HUB_EXCEPTIONS_ACTIONS ?? "").trim().toLowerCase() === "on";
}
