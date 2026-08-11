/**
 * Poller auto-reprogramado, sin solapamiento y pausable (FASE 2 · objetivo 6).
 *
 * PROBLEMA: LeadsClient tiene 7+ setInterval independientes que se solapan y
 * siguen disparando aunque la pestaña esté oculta (gasto de CPU/red/BD). Este
 * utilitario centraliza el patrón correcto:
 *   - AUTO-REPROGRAMADO: el siguiente tick se agenda cuando el anterior TERMINA
 *     (setTimeout encadenado), no cada intervalMs fijo → nunca hay dos tareas del
 *     mismo canal a la vez, aunque una tarde más que el intervalo.
 *   - PAUSABLE: pause()/resume() para parar cuando la pestaña se oculta
 *     (document.hidden) y reanudar (opcionalmente disparando ya) al volver.
 *
 * Es framework-agnóstico y puro (solo usa setTimeout/clearTimeout), para poder
 * testearlo con timers falsos. El hook de React que lo envuelve va aparte.
 */

export type Poller = {
  start: () => void;
  stop: () => void;
  pause: () => void;
  resume: (opts?: { runNow?: boolean }) => void;
  isStopped: () => boolean;
  isPaused: () => boolean;
};

export type PollerOptions = {
  intervalMs: number;
  task: () => void | Promise<void>;
  immediate?: boolean; // disparar una vez al arrancar
  onError?: (e: unknown) => void;
};

export function createPoller(opts: PollerOptions): Poller {
  const { intervalMs, task, immediate = false, onError } = opts;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = true;
  let paused = false;
  let inFlight = false;

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedule() {
    clearTimer();
    timer = setTimeout(run, intervalMs);
  }

  async function run() {
    timer = null;
    if (stopped || paused || inFlight) return; // sin solapamiento
    inFlight = true;
    try {
      await task();
    } catch (e) {
      onError?.(e);
    } finally {
      inFlight = false;
    }
    // Reprograma SOLO si seguimos activos (pudo pararse/pausarse durante la tarea).
    if (!stopped && !paused) schedule();
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      paused = false;
      if (immediate) void run();
      else schedule();
    },
    stop() {
      stopped = true;
      paused = false;
      clearTimer();
    },
    pause() {
      if (stopped || paused) return;
      paused = true;
      clearTimer();
    },
    resume(o) {
      if (stopped || !paused) return;
      paused = false;
      if (o?.runNow) void run();
      else schedule();
    },
    isStopped: () => stopped,
    isPaused: () => paused
  };
}
