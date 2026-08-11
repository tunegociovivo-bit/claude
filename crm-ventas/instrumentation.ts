export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerUrgentAlertMonitor } = await import("./instrumentation-node");
    registerUrgentAlertMonitor();
  }
}
