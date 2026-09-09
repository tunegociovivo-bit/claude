type ProgressRun = { createdAt: string | Date; items: Array<{ status: string; source?: string }> };

export function getAccountancyRunProgress(run: ProgressRun, now = new Date()) {
  const total = run.items.length;
  const completed = run.items.filter((item) => ["DOWNLOADED", "FAILED", "SKIPPED"].includes(item.status)).length;
  const percent = total ? Math.round((completed / total) * 100) : 0;
  if (!total || completed >= total) return { completed, total, percent: total ? 100 : 0, etaMinutes: 0, waitingForMetaAgent: false };
  const remaining = run.items.filter((item) => !["DOWNLOADED", "FAILED", "SKIPPED"].includes(item.status));
  const waitingForMetaAgent = remaining.length > 0 && remaining.every((item) => item.status === "PENDING" && item.source === "META");
  if (waitingForMetaAgent) return { completed, total, percent, etaMinutes: null, waitingForMetaAgent: true };
  const elapsedMinutes = Math.max(1 / 6, (now.getTime() - new Date(run.createdAt).getTime()) / 60_000);
  const minutesPerItem = completed ? elapsedMinutes / completed : 0.75;
  const etaMinutes = Math.max(1, Math.ceil(minutesPerItem * (total - completed)));
  return { completed, total, percent, etaMinutes, waitingForMetaAgent: false };
}
