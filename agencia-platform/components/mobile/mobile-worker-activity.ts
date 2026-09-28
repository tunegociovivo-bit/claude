export type MobileWorkerActivity = "idle" | "working" | "recovering" | "queued";

export function mobileWorkerActivity(executing: boolean, jobs: readonly { status: string }[]): MobileWorkerActivity {
  if (executing) return "working";
  if (jobs.some(job => job.status === "RUNNING")) return "recovering";
  if (jobs.some(job => job.status === "QUEUED")) return "queued";
  return "idle";
}

/** Stop waiting immediately on USB loss; the caller also aborts guarded device actions. */
export function runWhileConnected<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new Error("Se perdió la conexión USB. La tarea volverá a comprobarse al reconectar."));
    if (signal.aborted) { stop(); return; }
    signal.addEventListener("abort", stop, { once: true });
    Promise.resolve().then(() => { if (signal.aborted) throw new Error("Conexión USB interrumpida"); return run(); })
      .then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}
