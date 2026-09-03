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
      const { syncAllActiveMetaCommentFeeds } = await import("@/lib/meta/comments");
      const result = await syncAllActiveMetaCommentFeeds();
      if (result.created > 0) console.log(`[in-app-cron] comentarios Meta nuevos: ${result.created}`);
    } catch (e) {
      console.warn("[in-app-cron] meta comments:", (e as Error).message);
    }
    try {
      // Bubui: auto-expira mesas colgadas (>12h o pasado su expiresAt) para que
      // no queden "activas" para siempre tras un error de verificación.
      const { expireStaleTables } = await import("@/lib/bubui/table");
      const r = await expireStaleTables(12);
      if (r.expired > 0) console.log(`[in-app-cron] bubui mesas auto-expiradas: ${r.expired}`);
    } catch (e) {
      console.warn("[in-app-cron] bubui mesa expiry:", (e as Error).message);
    }
    try {
      // Bubui: push de acciones post-compra (~1 h) → descuento por compartir/
      // reseña/seguir/foto. Solo negocios con postPurchasePushEnabled.
      const { runPostPurchaseActionPush } = await import("@/lib/bubui/post-purchase");
      const r = await runPostPurchaseActionPush();
      if (r.sent > 0) console.log(`[in-app-cron] bubui push acciones post-compra: ${r.sent}/${r.due}`);
    } catch (e) {
      console.warn("[in-app-cron] bubui post-purchase push:", (e as Error).message);
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
      // Backstop local para Holded + solicitudes SEPA. GitHub Actions puede
      // retrasar los schedules; este tick corre dentro del proceso persistente
      // de Railway. Todo el ciclo es idempotente por factura/solicitud.
      const { runSepaCronAllWorkspaces } = await import("@/lib/facturacion/sepa/cron");
      await runSepaCronAllWorkspaces();
    } catch (e) {
      console.warn("[in-app-cron] holded/sepa:", (e as Error).message);
    }
    try {
      const { processAllPendingGoogleAdsInvoiceRun, processAllPendingMetaInvoiceRun, processPendingHoldedInvoiceRun, runAccountancySchedules } = await import("@/lib/accountancy-invoices/service");
      await runAccountancySchedules();
      await processPendingHoldedInvoiceRun();
      await processAllPendingGoogleAdsInvoiceRun(undefined, 4);
      await processAllPendingMetaInvoiceRun(undefined, 8);
    } catch (e) {
      console.warn("[in-app-cron] facturas gestoría:", (e as Error).message);
    }
    try {
      const { monitorOfflineBankAgents } = await import("@/lib/facturacion/sepa/agent-watchdog");
      const result = await monitorOfflineBankAgents();
      if (result.notified > 0) console.warn(`[in-app-cron] agentes bancarios offline avisados: ${result.notified}`);
    } catch (e) {
      console.warn("[in-app-cron] bank-agent-watchdog:", (e as Error).message);
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
          const { runSubvencionesDaily } = await import("@/lib/subvenciones/runner");
          const result = await runSubvencionesDaily("cron");
          if (!(result as any).skipped) console.log("[in-app-cron] subvenciones: ejecución diaria completada");
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

  // Google Posts programados: publica en las fichas los GmbPost vencidos. Cada
  // 5 min es de sobra (la precisión de un post no requiere el minuto).
  const GMB_TICK_MS = 5 * 60 * 1000;
  async function gmbTick() {
    try {
      const { publishScheduledGmbPosts } = await import("@/lib/gmb/publish-scheduled");
      await publishScheduledGmbPosts();
    } catch (e) {
      console.warn("[in-app-cron] gmb-posts:", (e as Error).message);
    }
    // Jobs del Rank Grid (bounded, tenant-scoped). Solo miden si hay proveedor (clave Maps).
    try {
      const { processAllRankJobs } = await import("@/lib/gmb/rank-cron");
      await processAllRankJobs(2);
    } catch (e) {
      console.warn("[in-app-cron] gmb-rank:", (e as Error).message);
    }
    // Piloto automático (solo fichas con política activa; efectos internos seguros; externas → aprobación).
    try {
      const { processAllAutopilot } = await import("@/lib/gmb/autopilot-scheduler");
      const { prisma } = await import("@/lib/db/prisma");
      await processAllAutopilot(prisma, { maxClients: 50 });
    } catch (e) {
      console.warn("[in-app-cron] gmb-autopilot:", (e as Error).message);
    }
    // Alertas del portfolio (idempotente, auto-sanadora; webhooks solo si están configurados).
    try {
      const { processAllGmbAlerts } = await import("@/lib/gmb/alerts-cron");
      const { prisma } = await import("@/lib/db/prisma");
      await processAllGmbAlerts(prisma, { maxWorkspaces: 50 });
    } catch (e) {
      console.warn("[in-app-cron] gmb-alerts:", (e as Error).message);
    }
  }
  setTimeout(gmbTick, 120_000);
  setInterval(gmbTick, GMB_TICK_MS);

  // Watchdog de sesiones WAHA: reinicia las que se caen (STOPPED). Cada 3 min.
  const WAHA_WATCHDOG_MS = 3 * 60 * 1000;
  async function wahaWatchdogTick() {
    try {
      const { autoRestartDownSessionsAllWorkspaces } = await import("@/lib/leads/session-watchdog");
      await autoRestartDownSessionsAllWorkspaces();
    } catch (e) {
      console.warn("[in-app-cron] waha-watchdog:", (e as Error).message);
    }
  }
  setTimeout(wahaWatchdogTick, 150_000);
  setInterval(wahaWatchdogTick, WAHA_WATCHDOG_MS);

  // Facturas gestoría tiene su propio ciclo: no debe quedar bloqueado por
  // recordatorios, GMB u otros trabajos lentos del tick general.
  let accountancyBusy = false;
  async function accountancyTick() {
    if (accountancyBusy) return;
    accountancyBusy = true;
    try {
      const { processAllPendingGoogleAdsInvoiceRun, processAllPendingMetaInvoiceRun, processPendingHoldedInvoiceRun, runAccountancySchedules } = await import("@/lib/accountancy-invoices/service");
      await runAccountancySchedules();
      await processPendingHoldedInvoiceRun();
      await processAllPendingGoogleAdsInvoiceRun(undefined, 4);
      await processAllPendingMetaInvoiceRun(undefined, 8);
    } catch (e) {
      console.warn("[in-app-cron] facturas gestoría independiente:", (e as Error).message);
    } finally {
      accountancyBusy = false;
    }
  }
  setTimeout(accountancyTick, 30_000);
  setInterval(accountancyTick, 2 * 60 * 1000);

  console.log(
    "[in-app-cron] planificador interno activo (general 5 min · facturas 2 min · leads 1 min · gmb-posts 5 min · waha-watchdog 3 min)."
  );
}
