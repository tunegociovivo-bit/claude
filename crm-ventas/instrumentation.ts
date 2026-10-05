export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerUrgentAlertMonitor, registerInboxWorker } = await import("./instrumentation-node");
    registerUrgentAlertMonitor();
    if (process.env.INBOX_WORKER_DISABLED !== "1") registerInboxWorker();
  }
}
