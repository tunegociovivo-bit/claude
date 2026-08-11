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
