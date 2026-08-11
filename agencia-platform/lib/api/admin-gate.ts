/**
 * Gate central de rol ADMIN (FASE 1 · Punto 1).
 *
 * PROBLEMA: `withApi({scope:"admin"})` NO exige rol. authenticate() da a toda
 * sesión humana `scopes = {"*"}`, y requireScope pasa con "*". Por eso ~56 rutas
 * `/api/v1/admin/*` eran accesibles por cualquier MIEMBRO autenticado (escalada
 * de privilegios intra-tenant). El único gate real era llamar a requireAdmin /
 * callerIsAdmin en cada ruta — y muchas no lo hacían.
 *
 * SOLUCIÓN: gate ÚNICO en withApi, aplicado a:
 *   - toda ruta bajo `/api/v1/admin/…` (por PATH, así no hay que tocar 56
 *     ficheros ni recordar añadir el guard en cada nuevo endpoint), y
 *   - cualquier ruta que declare explícitamente `withApi({ admin: true })`.
 *
 * Reversibilidad (env `HUB_ADMIN_ENFORCE`):
 *   - "log"     (POR DEFECTO): NO bloquea; solo REGISTRA los accesos que en
 *                enforce serían 403. Al desplegar no rompe a ningún miembro:
 *                se mide primero quién usa el área admin.  <- "preparado, no activo"
 *   - "enforce": bloquea (403) a los no-admin. Estado objetivo tras medir.
 *   - "off":     desactiva el gate por completo (vuelta atrás inmediata).
 *
 * Nota: las API keys se consideran autorizadas (callerIsAdmin=true) para no
 * romper integraciones; el gate cierra la escalada de sesiones HUMANAS de
 * miembros. Las llamadas de cron NO pasan por aquí (no autentican en withApi).
 */

export type AdminEnforceMode = "off" | "log" | "enforce";

export function adminEnforceMode(env: NodeJS.ProcessEnv = process.env): AdminEnforceMode {
  const m = (env.HUB_ADMIN_ENFORCE ?? "").trim().toLowerCase();
  if (m === "off" || m === "log" || m === "enforce") return m;
  return "log"; // por defecto: shadow (no rompe al desplegar)
}

/** ¿La ruta es del área admin (por path)? */
export function isAdminPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname.startsWith("/api/v1/admin/") || pathname === "/api/v1/admin";
}

/**
 * ¿Esta petición debe pasar el gate de admin? (por path o por opción explícita)
 */
export function requiresAdmin(pathname: string | null | undefined, explicit?: boolean): boolean {
  return explicit === true || isAdminPath(pathname);
}
