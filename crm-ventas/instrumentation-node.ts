export function registerUrgentAlertMonitor() {
  const state = globalThis as typeof globalThis & { __urgentAlertTimer?: ReturnType<typeof setInterval> };
  if (state.__urgentAlertTimer) return;
  const run = async () => {
    const { monitorUrgentAlerts } = await import("@/lib/urgent-alert-delivery");
    await monitorUrgentAlerts().catch((error) => console.error("[urgent-alerts] monitor failed:", error?.message));
  };
  setTimeout(() => void run(), 15_000).unref();
  state.__urgentAlertTimer = setInterval(() => void run(), 2 * 60 * 1000);
  state.__urgentAlertTimer.unref();
}

// Bandeja unificada de WhatsApp: IA con espera, cola de salida anti-baneo y
// vigilancia del estado de cada número.
export function registerInboxWorker() {
  const state = globalThis as typeof globalThis & { __inboxTimer?: ReturnType<typeof setInterval> };
  if (state.__inboxTimer) return;
  const run = async () => {
    const { runInboxTick } = await import("@/lib/inbox/worker");
    await runInboxTick().catch((error) => console.error("[inbox-worker] tick failed:", error?.message));
  };
  setTimeout(() => void run(), 10_000).unref();
  state.__inboxTimer = setInterval(() => void run(), 3_000);
  state.__inboxTimer.unref();
}

// Módulos de contenidos (Editorial y Publicador SEO). Solo actúan sobre
// workspaces con el módulo activo; si no hay ninguno, cada tick es una
// consulta vacía.
export function registerContentWorkers() {
  const state = globalThis as typeof globalThis & { __contentTimers?: ReturnType<typeof setInterval>[] };
  if (state.__contentTimers) return;
  state.__contentTimers = [];

  // Publicación programada en Facebook/Instagram (cada destino se reclama de
  // forma atómica en BD, así que varias instancias no duplican).
  let editorialBusy = false;
  const editorialTick = async () => {
    if (editorialBusy) return;
    editorialBusy = true;
    try {
      const { publishScheduledEditorialMetaPublications } = await import("@/lib/editorial/meta-publishing");
      const result = await publishScheduledEditorialMetaPublications(10);
      if (result.published || result.failed) console.log(`[editorial] Meta: ${result.published} publicadas, ${result.failed} fallidas`);
    } catch (error) {
      console.warn("[editorial] tick:", (error as Error).message);
    } finally {
      editorialBusy = false;
    }
  };
  setTimeout(() => void editorialTick(), 30_000).unref();
  const t1 = setInterval(() => void editorialTick(), 60_000);
  t1.unref();
  state.__contentTimers.push(t1);

  // Publicador SEO: avanza redacción → imágenes → revisión → publicación.
  // Lease distribuido: solo una instancia procesa la cola a la vez.
  let seoBusy = false;
  const owner = `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  const seoTick = async () => {
    if (seoBusy) return;
    seoBusy = true;
    let acquired = false;
    try {
      const { acquireCronLease } = await import("@/lib/cron/distributed-lease");
      acquired = await acquireCronLease("content/seo-blog", owner, 5 * 60 * 1000);
      if (!acquired) return;
      const { runSeoBlogTick } = await import("@/lib/seo-blog/pipeline");
      const r = await runSeoBlogTick(170_000);
      if (r.processed > 0) console.log(`[seo-blog] ${r.processed} paso(s) ejecutados`);
    } catch (error) {
      console.warn("[seo-blog] tick:", (error as Error).message);
    } finally {
      if (acquired) {
        const { releaseCronLease } = await import("@/lib/cron/distributed-lease");
        await releaseCronLease("content/seo-blog", owner).catch(() => undefined);
      }
      seoBusy = false;
    }
  };
  setTimeout(() => void seoTick(), 45_000).unref();
  const t2 = setInterval(() => void seoTick(), 2 * 60 * 1000);
  t2.unref();
  state.__contentTimers.push(t2);
}
