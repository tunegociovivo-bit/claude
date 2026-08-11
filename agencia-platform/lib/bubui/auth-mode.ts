/**
 * Modo de autenticación de los endpoints Bubui (FASE 1 · Punto 2).
 *
 * Tres estados, para un endurecimiento fail-closed SIN romper a los clientes
 * existentes al desplegar:
 *
 *  - "lazy"   (por defecto, = comportamiento actual): si NO se presenta token
 *             (cliente/app antiguos), se PERMITE. Sigue exigiendo token válido a
 *             quien SÍ lo presenta.
 *  - "shadow": igual que lazy (se PERMITE), pero REGISTRA cada acceso sin token
 *             para medir cuánto tráfico legacy queda antes de cerrar. Es el paso
 *             de medición previo a "strict". No cambia el acceso.
 *  - "strict" (fail-closed): sin token → 401. Estado final una vez el tráfico
 *             sin token es ~0 (ver SECURITY-PHASE1.md).
 *
 * Back-compat: los flags previos `BUBUI_REQUIRE_CUSTOMER_TOKEN=true` /
 * `BUBUI_REQUIRE_BUSINESS_TOKEN=true` siguen significando "strict".
 */

export type BubuiAuthMode = "lazy" | "shadow" | "strict";

function parseMode(v: string | undefined): BubuiAuthMode | null {
  const m = (v ?? "").trim().toLowerCase();
  return m === "lazy" || m === "shadow" || m === "strict" ? m : null;
}

export function customerAuthMode(env: NodeJS.ProcessEnv = process.env): BubuiAuthMode {
  if (env.BUBUI_REQUIRE_CUSTOMER_TOKEN === "true") return "strict";
  return parseMode(env.BUBUI_CUSTOMER_AUTH_MODE) ?? "lazy";
}

export function businessAuthMode(env: NodeJS.ProcessEnv = process.env): BubuiAuthMode {
  if (env.BUBUI_REQUIRE_BUSINESS_TOKEN === "true") return "strict";
  return parseMode(env.BUBUI_BUSINESS_AUTH_MODE) ?? "lazy";
}

/**
 * Decide, para una petición SIN token válido, si se permite y si hay que
 * registrarla. Centraliza la semántica de los 3 modos.
 */
export function decideNoToken(mode: BubuiAuthMode): { allow: boolean; log: boolean } {
  if (mode === "strict") return { allow: false, log: false };
  if (mode === "shadow") return { allow: true, log: true };
  return { allow: true, log: false }; // lazy
}
