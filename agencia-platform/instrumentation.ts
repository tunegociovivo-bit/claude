/**
 * Hook de instrumentación de Next: se ejecuta UNA vez al arrancar el
 * servidor. Lo usamos para lanzar el planificador interno (recordatorios
 * + briefing) sin depender de cron externo. Solo en runtime Node.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.DISABLE_INAPP_CRON === "1") return;
  const { startInAppScheduler } = await import("@/lib/cron/in-app-scheduler");
  startInAppScheduler();
}
