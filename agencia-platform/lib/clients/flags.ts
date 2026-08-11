/**
 * Feature flag / kill-switch de Cliente 360 (FASE 3).
 * Aditivo: por defecto ACTIVO (el endpoint es nuevo y de solo lectura). Se
 * desactiva con HUB_CLIENT360=off → la ruta responde 404 (fallback: la pantalla
 * de cliente actual sigue intacta y no depende de este endpoint).
 */
export function client360Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.HUB_CLIENT360 ?? "").trim().toLowerCase() !== "off";
}
