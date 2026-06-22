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
    try {
      // Genera las facturas recurrentes que toque emitir.
      const { runRecurringInvoices } = await import("@/lib/invoicing/recurring");
      const res = await runRecurringInvoices();
      if (res.generated > 0) console.log(`[in-app-cron] facturas recurrentes generadas: ${res.generated}`);
    } catch (e) {
      console.warn("[in-app-cron] recurring invoices:", (e as Error).message);
    }
    try {
      // Bubui: geocodifica negocios sin coordenadas (1 tanda/día). Idempotente:
      // si no quedan pendientes, no hace nada.
      const bubuiHour = parseInt(process.env.BUBUI_MAINT_HOUR_UTC ?? "4", 10);
      if (new Date().getUTCHours() === bubuiHour) {
        const maint = await import("@/lib/bubui/directory-maintenance");
        const geo = await maint.runBubuiGeoBackfill(30);
        if (geo.updated > 0) console.log(`[in-app-cron] bubui geo: ${geo.updated} geocodificados, ${geo.remaining} pendientes`);
        const rat = await maint.runBubuiGoogleRatingRefresh(30);
        if (rat.updated > 0) console.log(`[in-app-cron] bubui google rating: ${rat.updated} actualizadas, ${rat.remaining} pendientes`);
        // Subvenciones: ingesta nocturna del catálogo de convocatorias (BDNS).
        try {
          const { ingestConvocatorias } = await import("@/lib/subvenciones/bdns");
          const r = await ingestConvocatorias();
          console.log(`[in-app-cron] subvenciones: ${r.upserted} convocatorias (${r.fueraDeFoco} fuera de foco)`);
          const { runSubvencionAlertas, runAgencyOpportunityAlerts } = await import("@/lib/subvenciones/alertas");
          const a = await runSubvencionAlertas();
          if (a.enviados > 0) console.log(`[in-app-cron] subvenciones avisos: ${a.enviados}`);
          const op = await runAgencyOpportunityAlerts();
          if (op.enviados > 0) console.log(`[in-app-cron] subvenciones oportunidad TOP agencia: ${op.enviados}`);
          // Bubui: barre comercios (altas nuevas + re-escaneo semanal) para
          // encontrar subvenciones de su nicho y crear propuestas a revisar.
          const { runBubuiSubvencionScan } = await import("@/lib/bubui/subvenciones");
          const bs = await runBubuiSubvencionScan(40);
          if (bs.proposalsCreated > 0) console.log(`[in-app-cron] bubui subvenciones: ${bs.proposalsCreated} propuestas de ${bs.scanned} comercios`);
        } catch (e) {
          console.warn("[in-app-cron] subvenciones:", (e as Error).message);
        }
      }
    } catch (e) {
      console.warn("[in-app-cron] bubui geo:", (e as Error).message);
    }
  }

  // Primer tick 60s tras el arranque (deja estabilizar la app y la BD).
  setTimeout(tick, 60_000);
  setInterval(tick, TICK_MS);

  // NV Leads Pro: cola de WhatsApp + secuencias + búsquedas. Tick cada
  // minuto (como el WP-Cron del plugin). El ritmo REAL de envío lo marca el
  // anti-baneo de la cola (delay min–max, ventana horaria, tope diario y
  // cadencia mínima): aunque el tick corra cada minuto, processQueueTick
  // solo envía si toca, así que no hay riesgo de ráfaga.
  const LEADS_TICK_MS = 60 * 1000;
  async function leadsTick() {
    try {
      const { runLeadsCronAllWorkspaces } = await import("@/lib/leads/cron");
      await runLeadsCronAllWorkspaces();
    } catch (e) {
      console.warn("[in-app-cron] leads:", (e as Error).message);
    }
  }
  setTimeout(leadsTick, 90_000);
  setInterval(leadsTick, LEADS_TICK_MS);

  console.log("[in-app-cron] planificador interno activo (general 5 min · leads 1 min).");
}
