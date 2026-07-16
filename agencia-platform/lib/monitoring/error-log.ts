/**
 * Registro de errores en memoria (sin dependencias externas).
 *
 * Un buffer circular de los últimos errores capturados, para verlos en el panel
 * de Infraestructura sin tener que bucear por los logs de Railway. Es la versión
 * ligera de un APM: NO persiste (se vacía al reiniciar el proceso y es por
 * instancia), pero da visibilidad inmediata de "qué está fallando ahora".
 *
 * Para observabilidad completa (histórico, alertas, agrupación) el siguiente
 * paso es Sentry (@sentry/nextjs) — este módulo es el puente sin instalar nada.
 */

export type LoggedError = {
  at: string; // ISO
  where: string; // p.ej. "leads-cron:queue"
  message: string;
  workspaceId?: string | null;
};

const RING: LoggedError[] = [];
const MAX = 200;

/** Registra un error en el buffer y en la consola (Railway logs). */
export function logError(where: string, err: unknown, workspaceId?: string | null): void {
  const raw = err instanceof Error ? err.stack || err.message : String(err);
  RING.unshift({
    at: new Date().toISOString(),
    where,
    message: String(raw).slice(0, 1500),
    workspaceId: workspaceId ?? null
  });
  if (RING.length > MAX) RING.length = MAX;
  try {
    // eslint-disable-next-line no-console
    console.error(`[err:${where}]`, raw);
  } catch {
    /* noop */
  }
}

/** Últimos errores (más recientes primero). Opcionalmente filtra por workspace. */
export function recentErrors(limit = 100, workspaceId?: string | null): LoggedError[] {
  const list = workspaceId ? RING.filter((e) => e.workspaceId === workspaceId) : RING;
  return list.slice(0, Math.max(1, Math.min(limit, MAX)));
}

/** Resumen rápido para badges. */
export function errorStats(workspaceId?: string | null): { total: number; lastAt: string | null } {
  const list = recentErrors(MAX, workspaceId);
  return { total: list.length, lastAt: list[0]?.at ?? null };
}
