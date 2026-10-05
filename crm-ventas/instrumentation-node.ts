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
