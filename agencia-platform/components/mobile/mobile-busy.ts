/**
 * Cuenta los trabajos (o reclamaciones) en curso en esta pestaña. La recarga
 * automática por nueva versión espera a que no quede ninguno.
 */
let active = 0;
export function beginMobileWork() { active += 1; }
export function endMobileWork() { active = Math.max(0, active - 1); }
export function isMobileBusy() { return active > 0; }

/** ¿El servidor sirve un build más nuevo que el cargado en esta pestaña? */
export function isNewerBuild(loaded: string | undefined, server: unknown): boolean {
  const current = Number(loaded);
  const remote = Number(server);
  return Number.isFinite(current) && current > 0 && Number.isFinite(remote) && remote > current;
}

const RESUME_KEY = "nv-mobile-resume";
/** Pantallas que estaban abiertas, para reabrirlas solas tras recargar. */
export function loadResumeSerials(): Map<string, boolean> {
  try {
    const raw = JSON.parse(localStorage.getItem(RESUME_KEY) ?? "[]");
    return new Map(Array.isArray(raw) ? raw.filter((value) => typeof value === "string").map((serial: string) => [serial, true]) : []);
  } catch { return new Map(); }
}
export function saveResumeSerials(map: ReadonlyMap<string, boolean>) {
  try { localStorage.setItem(RESUME_KEY, JSON.stringify([...map].filter(([, resume]) => resume).map(([serial]) => serial))); } catch { /* sin almacenamiento */ }
}
