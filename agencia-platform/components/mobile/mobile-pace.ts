/**
 * Ritmo adaptativo para móviles lentos: mide cuánto tarda Android en devolver la
 * estructura de pantalla y alarga todas las esperas en proporción.
 * Un móvil rápido (~1 s por lectura) usa las esperas base; uno lento (4–6 s) las
 * multiplica hasta ×3,5.
 */
export type PacedDependencies = {
  read: () => Promise<string>;
  wait: (ms: number) => Promise<void>;
};

export const PACE_BASELINE_MS = 1_200;
export const PACE_MAX_FACTOR = 3.5;

export function paceFactor(averageReadMs: number): number {
  if (!Number.isFinite(averageReadMs) || averageReadMs <= 0) return 1.5;
  return Math.min(PACE_MAX_FACTOR, Math.max(1, averageReadMs / PACE_BASELINE_MS));
}

export function createPacedDependencies<T extends PacedDependencies>(deps: T, now: () => number = () => Date.now(), initialFactor = 1.5): T & { factor: () => number } {
  let average = 0;
  let samples = 0;
  const factor = () => samples === 0 ? initialFactor : paceFactor(average);
  return {
    ...deps,
    factor,
    read: async () => {
      const started = now();
      try { return await deps.read(); }
      finally {
        const elapsed = now() - started;
        average = samples === 0 ? elapsed : average * 0.6 + elapsed * 0.4;
        samples += 1;
      }
    },
    wait: (ms: number) => deps.wait(Math.round(ms * factor()))
  };
}
