/**
 * Vigilancia de trabajos en ejecución en el navegador.
 * - Un trabajo puede marcarse como abortado (tiempo máximo agotado, lease perdido).
 * - Todas las acciones sobre el móvil se envuelven para que, si el trabajo está
 *   abortado o una acción se cuelga, fallen en vez de quedarse esperando para siempre.
 */
const aborted = new Set<string>();
const generations = new Map<string, number>();

export class MobileJobAbortedError extends Error {}

export function abortMobileJob(jobId: string | undefined) {
  if (jobId) aborted.add(jobId);
}

export function clearMobileJob(jobId: string | undefined) {
  if (jobId) { aborted.delete(jobId); generations.set(jobId, (generations.get(jobId) ?? 0) + 1); }
}

export function isMobileJobAborted(jobId: string | undefined): boolean {
  return Boolean(jobId && aborted.has(jobId));
}

export function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); });
  return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

/** Envuelve cada función de dependencias: comprueba el aborto y limita su duración. */
export function guardDependencies<T extends Record<string, unknown>>(jobId: string | undefined, deps: T, stepTimeoutMs = 90_000): T {
  const generation = jobId ? generations.get(jobId) ?? 0 : 0;
  const stopped = () => isMobileJobAborted(jobId) || Boolean(jobId && (generations.get(jobId) ?? 0) !== generation);
  const guarded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(deps)) {
    if (typeof value !== "function") { guarded[key] = value; continue; }
    guarded[key] = async (...args: unknown[]) => {
      if (stopped()) throw new MobileJobAbortedError("La publicación se ha detenido (tiempo agotado o reactivada en otra pantalla).");
      const result = await withTimeout(Promise.resolve((value as (...a: unknown[]) => unknown)(...args)), stepTimeoutMs, `El móvil no ha respondido a tiempo (${key}). Se reintentará.`);
      if (stopped()) throw new MobileJobAbortedError("La publicación se ha detenido (tiempo agotado o reactivada en otra pantalla).");
      return result;
    };
  }
  return guarded as T;
}
