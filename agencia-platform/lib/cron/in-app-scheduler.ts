/**
 * Planificador interno: corre dentro del proceso Node de la app (que en
 * Railway es persistente), así NO hace falta cron externo (GitHub Actions
 * ni servicio cron de Railway) para los recordatorios y el briefing.
 *
 * Lo arranca instrumentation.ts en el boot del servidor. Idempotente: si
 * hay varias réplicas, la idempotencia de los propios trabajos evita
 * duplicados. Se puede desactivar con DISABLE_INAPP_CRON=1 (p.ej. si
 * prefieres gestionar los crons por fuera).
 */
import { runReminders, runBriefing } from "./scheduler";

let started = false;

export function startInAppScheduler(): void {
  if (started) return;
  started = true;

  const TICK_MS = 5 * 60 * 1000; // cada 5 min
  const briefingHour = parseInt(process.env.BRIEFING_HOUR_UTC ?? "6", 10); // 6 UTC ≈ 8:00 ES

  async function tick() {
    try {
      await runReminders();
    } catch (e) {
      console.warn("[in-app-cron] reminders:", (e as Error).message);
    }
    try {
      if (new Date().getUTCHours() === briefingHour) await runBriefing();
    } catch (e) {
      console.warn("[in-app-cron] briefing:", (e as Error).message);
    }
    try {
      // Renueva tokens de usuario de Meta próximos a caducar (no-op si no aplica).
      const { refreshMetaUserTokensIfNeeded } = await import("@/lib/integrations/meta-login");
      await refreshMetaUserTokensIfNeeded();
    } catch (e) {
      console.warn("[in-app-cron] meta token refresh:", (e as Error).message);
    }
  }

  // Primer tick 60s tras el arranque (deja estabilizar la app y la BD).
  setTimeout(tick, 60_000);
  setInterval(tick, TICK_MS);
  console.log("[in-app-cron] planificador interno activo (tick cada 5 min).");
}
