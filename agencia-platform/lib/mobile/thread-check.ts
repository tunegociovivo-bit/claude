import { prisma } from "@/lib/db/prisma";
import { parseCommentThreadMessage, serializeCommentThreadMessage } from "./comment-thread";
import { isDeviceOnline } from "./thread-failover";
import { parseThreadCheck, serializeThreadCheck, type ThreadCheck } from "./thread-check-schema";
export * from "./thread-check-schema";

/** Crea (si no existe ya una pendiente) la comprobación de una conversación. */
export async function createThreadCheck(workspaceId: string, threadId: string, options: { userId?: string | null; preferOnline?: boolean } = {}) {
  const jobs = await prisma.mobileAutomationJob.findMany({
    where: { workspaceId, action: "POST_THREAD_MESSAGE", idempotencyKey: { startsWith: `thread:${threadId}:` } },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true, text: true, deviceSerial: true, phoneKey: true }
  });
  const published = jobs.flatMap((job) => {
    if (job.status !== "COMPLETED") return [];
    try { const message = parseCommentThreadMessage(job.text ?? ""); return [{ job, message }]; } catch { return []; }
  });
  if (!published.length) throw new Error("La conversación no tiene mensajes publicados que comprobar.");
  const open = await prisma.mobileAutomationJob.findFirst({
    where: { workspaceId, action: "CHECK_THREAD", idempotencyKey: { startsWith: `threadcheck:${threadId}:` }, status: { in: ["QUEUED", "RUNNING"] } },
    select: { id: true }
  });
  if (open) return { id: open.id, created: false };
  const executor = (options.preferOnline !== false ? published.find(({ job }) => isDeviceOnline(workspaceId, job.deviceSerial)) : undefined) ?? published[0]!;
  const count = await prisma.mobileAutomationJob.count({ where: { workspaceId, idempotencyKey: { startsWith: `threadcheck:${threadId}:` } } });
  const check: ThreadCheck = {
    kind: "thread_check", version: 1, threadId, postUrl: published[0]!.message.postUrl, checkedAt: null,
    items: published.map(({ job, message }) => ({ jobId: job.id, order: message.order, text: message.text, visible: null, reactions: null, replies: null }))
  };
  const now = new Date();
  const created = await prisma.mobileAutomationJob.create({
    data: {
      workspaceId, phoneKey: executor.job.phoneKey, deviceSerial: executor.job.deviceSerial, platform: "facebook",
      action: "CHECK_THREAD", sourceKind: "COMMENT_THREAD", sourceRef: `Comprobación · ${published[0]!.message.guide.slice(0, 100)}`,
      targetUrl: check.postUrl, text: serializeThreadCheck(check), status: "QUEUED", scheduledAt: now, approvedAt: now,
      approvedById: options.userId ?? null, createdById: options.userId ?? null, maxAttempts: 3,
      expiresAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000), idempotencyKey: `threadcheck:${threadId}:${count + 1}`
    },
    select: { id: true }
  });
  return { id: created.id, created: true };
}

/** Guarda el resultado de la comprobación en cada mensaje publicado. */
export async function applyThreadCheckResult(workspaceId: string, resultText: string) {
  const check = parseThreadCheck(resultText);
  const checkedAt = check.checkedAt ?? new Date().toISOString();
  for (const item of check.items) {
    if (item.visible === null) continue;
    const job = await prisma.mobileAutomationJob.findFirst({ where: { id: item.jobId, workspaceId, action: "POST_THREAD_MESSAGE" }, select: { id: true, text: true } });
    if (!job) continue;
    try {
      const message = parseCommentThreadMessage(job.text ?? "");
      const text = serializeCommentThreadMessage({ ...message, engagement: { checkedAt, visible: item.visible, reactions: item.reactions, replies: item.replies } });
      await prisma.mobileAutomationJob.updateMany({ where: { id: job.id, workspaceId, text: job.text }, data: { text } });
    } catch { /* mensaje dañado: se ignora */ }
  }
}

const lastAuto = new Map<string, number>();
/** 24 h después de terminar una conversación se comprueba sola una vez. */
export async function scheduleAutomaticThreadChecks(workspaceId: string, now = new Date()) {
  const last = lastAuto.get(workspaceId) ?? 0;
  if (now.getTime() - last < 10 * 60 * 1000) return 0;
  lastAuto.set(workspaceId, now.getTime());
  const recent = await prisma.mobileAutomationJob.findMany({
    where: { workspaceId, action: "POST_THREAD_MESSAGE", status: "COMPLETED", completedAt: { lte: new Date(now.getTime() - 24 * 60 * 60 * 1000), gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } },
    select: { idempotencyKey: true }, take: 300
  });
  const threadIds = [...new Set(recent.map((row) => /^thread:([^:]+):/.exec(row.idempotencyKey)?.[1]).filter((id): id is string => Boolean(id)))];
  let created = 0;
  for (const threadId of threadIds) {
    const pending = await prisma.mobileAutomationJob.count({ where: { workspaceId, action: "POST_THREAD_MESSAGE", idempotencyKey: { startsWith: `thread:${threadId}:` }, status: { notIn: ["COMPLETED", "REJECTED", "CANCELLED"] } } });
    if (pending) continue;
    const done = await prisma.mobileAutomationJob.count({ where: { workspaceId, idempotencyKey: { startsWith: `threadcheck:${threadId}:` } } });
    if (done) continue;
    try { await createThreadCheck(workspaceId, threadId, { preferOnline: true }); created += 1; } catch { /* sin mensajes publicados */ }
  }
  return created;
}
