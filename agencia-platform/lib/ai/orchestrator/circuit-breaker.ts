/**
 * Circuit breaker por proveedor (Slice 2c.2) — PURO y determinista (el reloj se
 * inyecta como `now`). Evita martillear un proveedor que falla: tras N fallos en
 * ventana → OPEN (no pasa) durante un cooldown → HALF_OPEN (deja pasar 1 sonda);
 * si la sonda va bien → CLOSED, si falla → OPEN de nuevo.
 */
export type BreakerState = "closed" | "open" | "half_open";

export type BreakerConfig = { failureThreshold: number; windowMs: number; cooldownMs: number };
export const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 3, windowMs: 60_000, cooldownMs: 30_000 };

export type BreakerSnapshot = {
  state: BreakerState;
  failures: number[]; // timestamps de fallos recientes (dentro de la ventana)
  openedAt: number | null;
  halfOpenInFlight: boolean;
};

export function initBreaker(): BreakerSnapshot {
  return { state: "closed", failures: [], openedAt: null, halfOpenInFlight: false };
}

function prune(failures: number[], now: number, windowMs: number): number[] {
  return failures.filter((t) => now - t < windowMs);
}

/** ¿Se puede intentar el proveedor ahora? Devuelve el estado efectivo + si es sonda.
 *
 * CONTRATO DE CONCURRENCIA (F2): `canPass` es PURO y NO persiste la transición a
 * half-open. El tope de "una sola sonda" depende de `halfOpenInFlight`, que solo
 * pasa a true cuando el llamante persiste `markProbe`. Por tanto el llamante DEBE
 * serializar `canPass`→(persistir `markProbe`) bajo un lock por proveedor antes de
 * lanzar la sonda; si no, N llamadas concurrentes tras el cooldown verían todas
 * `pass:true` y martillearían un proveedor aún caído. En SHADOW (2c) no hay red ni
 * llamada real, así que no hay riesgo hoy; esta disciplina es obligatoria cuando se
 * cablee un adaptador LIVE. */
export function canPass(b: BreakerSnapshot, now: number, cfg: BreakerConfig = DEFAULT_BREAKER): { pass: boolean; probe: boolean; state: BreakerState } {
  if (b.state === "open") {
    if (b.openedAt != null && now - b.openedAt >= cfg.cooldownMs) {
      // cooldown cumplido → permite UNA sonda (half-open)
      return { pass: !b.halfOpenInFlight, probe: true, state: "half_open" };
    }
    return { pass: false, probe: false, state: "open" };
  }
  if (b.state === "half_open") {
    return { pass: !b.halfOpenInFlight, probe: true, state: "half_open" };
  }
  return { pass: true, probe: false, state: "closed" };
}

/** Registra el INICIO de una sonda (marca in-flight para no lanzar 2 a la vez). */
export function markProbe(b: BreakerSnapshot): BreakerSnapshot {
  return { ...b, state: "half_open", halfOpenInFlight: true };
}

export function recordSuccess(b: BreakerSnapshot): BreakerSnapshot {
  // Éxito → cierra el circuito y limpia.
  return { state: "closed", failures: [], openedAt: null, halfOpenInFlight: false };
}

export function recordFailure(b: BreakerSnapshot, now: number, cfg: BreakerConfig = DEFAULT_BREAKER): BreakerSnapshot {
  // Un fallo en half-open re-abre inmediatamente.
  if (b.state === "half_open") {
    return { state: "open", failures: prune(b.failures, now, cfg.windowMs), openedAt: now, halfOpenInFlight: false };
  }
  const failures = [...prune(b.failures, now, cfg.windowMs), now];
  if (failures.length >= cfg.failureThreshold) {
    return { state: "open", failures, openedAt: now, halfOpenInFlight: false };
  }
  return { ...b, state: "closed", failures, halfOpenInFlight: false };
}
