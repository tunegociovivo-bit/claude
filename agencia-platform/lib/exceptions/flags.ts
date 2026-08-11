/**
 * Kill-switch de la bandeja de excepciones (FASE 4a). Aditivo: por defecto
 * ACTIVO (endpoint nuevo de solo lectura). `HUB_EXCEPTIONS=off` → 404 (la UI
 * actual no depende de él).
 */
export function exceptionsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.HUB_EXCEPTIONS ?? "").trim().toLowerCase() !== "off";
}
