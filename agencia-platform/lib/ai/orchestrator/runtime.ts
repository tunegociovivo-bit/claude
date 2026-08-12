/**
 * Runtime del orquestador (G3+G5) — piezas COMPONIBLES para ejecutar el bucle real
 * de forma segura. Puro/inyectable (reloj, lock, adapters) → testeable sin red ni BD.
 *
 *  - withDeadline: deadline real (AbortController + timeout) por intento y global
 *    (maxWallMs). Una llamada colgada se CANCELA (cierra HIGH-1 en el punto de llamada).
 *  - serializedProbe: garantiza la sonda ÚNICA del circuit breaker bajo un lock por
 *    proveedor (inyectado) — cierra HIGH-2 (canPass→markProbe atómico por proveedor).
 *  - planSubtasks: decompose → validateDag con techo de autonomía del padre (G5), NUNCA
 *    eleva permisos.
 *  - chooseProvider: switch_provider consulta el routing/salud REAL (routeSlots), no
 *    un proveedor ciego; respeta el breaker abierto (G5).
 */
import { canPass, markProbe, recordSuccess, recordFailure, type BreakerSnapshot, type BreakerConfig, DEFAULT_BREAKER } from "./circuit-breaker";
import { validateDag, type SubtaskNode, type DagValidation, DEFAULT_DAG_LIMITS, type DagLimits } from "./dag";
import { routeSlots, type ModelSlot, type RoutingNeed, type ProviderId } from "./providers";
import type { AutonomyLevel } from "@/lib/ai/autonomy/policy";

export class DeadlineExceeded extends Error {
  constructor(public phase: string) {
    super(`Deadline superado en ${phase}`);
    this.name = "DeadlineExceeded";
  }
}

/**
 * Ejecuta `fn(signal)` con un deadline real. Si `fn` no resuelve en `ms`, se aborta
 * el signal y se lanza `DeadlineExceeded`. `deps.setTimeout/clearTimeout` inyectables.
 */
export async function withDeadline<T>(
  ms: number,
  fn: (signal: AbortSignal) => Promise<T>,
  deps: { setTimeout?: typeof setTimeout; clearTimeout?: typeof clearTimeout; phase?: string } = {}
): Promise<T> {
  const set = deps.setTimeout ?? setTimeout;
  const clr = deps.clearTimeout ?? clearTimeout;
  const ac = new AbortController();
  let timer: any;
  const timeout = new Promise<never>((_, reject) => {
    timer = set(() => {
      ac.abort();
      reject(new DeadlineExceeded(deps.phase ?? "attempt"));
    }, Math.max(1, ms));
  });
  try {
    return await Promise.race([fn(ac.signal), timeout]);
  } finally {
    clr(timer);
  }
}

/** Presupuesto de tiempo global: ¿queda margen para otro intento de `attemptMs`? */
export function withinWallBudget(startedAtMs: number, nowMs: number, maxWallMs: number, attemptMs: number): boolean {
  return nowMs - startedAtMs + attemptMs <= maxWallMs;
}

export type Lock = <T>(key: string, fn: () => Promise<T>) => Promise<T>;

/**
 * Decide y REGISTRA la sonda de half-open bajo un lock por proveedor. El lock
 * (inyectado: memoria en test, advisory-lock/Redis en prod) serializa canPass→persist,
 * garantizando que solo UNA sonda pasa tras el cooldown, aunque haya N concurrentes.
 * `persist` guarda el nuevo snapshot (markProbe) de forma durable.
 */
export async function serializedProbe(
  lock: Lock,
  provider: string,
  load: () => Promise<BreakerSnapshot>,
  persist: (b: BreakerSnapshot) => Promise<void>,
  nowMs: number,
  cfg: BreakerConfig = DEFAULT_BREAKER
): Promise<{ pass: boolean; probe: boolean }> {
  return await lock(`breaker:${provider}`, async () => {
    const b = await load();
    const decision = canPass(b, nowMs, cfg);
    if (decision.pass && decision.probe) {
      await persist(markProbe(b)); // marca la sonda en vuelo ANTES de soltar el lock
    }
    return { pass: decision.pass, probe: decision.probe };
  });
}

/** Cierra/abre el breaker tras el resultado real de la llamada (durable). */
export async function settleBreaker(load: () => Promise<BreakerSnapshot>, persist: (b: BreakerSnapshot) => Promise<void>, ok: boolean, nowMs: number, cfg: BreakerConfig = DEFAULT_BREAKER): Promise<void> {
  const b = await load();
  await persist(ok ? recordSuccess(b) : recordFailure(b, nowMs, cfg));
}

/**
 * G5: valida una descomposición propuesta contra el techo de autonomía del padre.
 * Envuelve validateDag para que el runtime NUNCA ejecute subtareas que eleven permisos
 * o formen ciclos / excedan límites.
 */
export function planSubtasks(nodes: SubtaskNode[], parentAutonomy: AutonomyLevel, limits: DagLimits = DEFAULT_DAG_LIMITS): DagValidation {
  return validateDag(nodes, parentAutonomy, limits);
}

/**
 * G5: elige el siguiente proveedor REAL para switch_provider, consultando salud
 * (presencia de key) + capacidades vía routeSlots, excluyendo proveedores con breaker
 * ABIERTO y los ya probados. Devuelve null si no hay ninguno sano → el controller
 * escala en vez de reintentar a ciegas.
 */
export function chooseProvider(
  need: RoutingNeed,
  env: NodeJS.ProcessEnv,
  opts: { exclude?: ProviderId[]; breakerOpen?: (p: ProviderId) => boolean } = {}
): ModelSlot | null {
  const slots = routeSlots({ ...need, excludeProviders: [...(need.excludeProviders ?? []), ...(opts.exclude ?? [])] }, env);
  for (const s of slots) {
    if (opts.breakerOpen?.(s.provider)) continue; // no martillear un proveedor caído
    return s;
  }
  return null;
}
