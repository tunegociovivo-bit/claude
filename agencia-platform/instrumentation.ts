/**
 * Hook de instrumentación de Next: se ejecuta UNA vez al arrancar el
 * servidor. Lanza el planificador interno (recordatorios + briefing) sin
 * cron externo.
 *
 * IMPORTANTE: el import dinámico va ANIDADO dentro de
 * `if (NEXT_RUNTIME === "nodejs")`. Next sustituye process.env.NEXT_RUNTIME
 * en tiempo de build por bundle, así elimina por completo este bloque (y su
 * cadena de imports: web-push → http/https/net) del bundle edge, que no
 * tiene módulos nativos de Node. Con un early-return invertido el build
 * fallaba con "Can't resolve 'http'/'https'/'net'".
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.DISABLE_INAPP_CRON === "1") return;
    const { startInAppScheduler } = await import("@/lib/cron/in-app-scheduler");
    startInAppScheduler();
  }
}
