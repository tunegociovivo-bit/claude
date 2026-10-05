import { prisma } from "@/lib/db/prisma";
import type { SharedMobilePhone } from "./shared-phones";
import { parseCommentThreadMessage, serializeCommentThreadMessage } from "./comment-thread";
import { threadIdFromKey } from "./thread-resume";

/** Fallos seguidos en el mismo móvil antes de pasar el mensaje a otro móvil libre. */
export const THREAD_FAILOVER_FAILURES = 3;
/** Un mensaje pendiente cuyo móvil no se conecta en este tiempo también se reasigna. */
export const THREAD_FAILOVER_OFFLINE_MS = 15 * 60 * 1000;
/** Un móvil está «conectado» si ha pedido trabajo en este margen. */
export const DEVICE_ONLINE_MS = 3 * 60 * 1000;
const THROTTLE_MS = 60 * 1000;
const FAILURE_EVENTS = ["RETRY_SCHEDULED", "FAILED"];
const REASSIGNED = "THREAD_REASSIGNED";

const deviceSeen = new Map<string, number>();
const lastRun = new Map<string, number>();

/** Lo llama el claim: el móvil tiene la pantalla abierta y está pidiendo trabajo. */
export function markDeviceSeen(workspaceId: string, deviceSerial: string, now = Date.now()) {
  deviceSeen.set(`${workspaceId}:${deviceSerial}`, now);
}
export function isDeviceOnline(workspaceId: string, deviceSerial: string, now = Date.now()) {
  const seen = deviceSeen.get(`${workspaceId}:${deviceSerial}`);
  return seen !== undefined && now - seen <= DEVICE_ONLINE_MS;
}
export function resetFailoverStateForTests() { deviceSeen.clear(); lastRun.clear(); }

type Candidate = { id: string; status: string; deviceSerial: string; idempotencyKey: string; text: string | null; scheduledAt: Date; createdAt: Date; leaseUntil: Date | null };

/**
 * Si el móvil de un mensaje de conversación lo bloquea (falla una y otra vez o no
 * se conecta), el mensaje pasa a otro móvil conectado, libre y que no tenga ningún
 * mensaje en esa conversación, para que la secuencia pueda terminar.
 * Nunca se mueve un mensaje cuyo envío pudo haberse hecho (pendiente de comprobar).
 */
export async function failoverBlockedThreadMessages(workspaceId: string, phones: readonly SharedMobilePhone[], now = new Date(), options: { force?: boolean } = {}) {
  const last = lastRun.get(workspaceId) ?? 0;
  if (!options.force && now.getTime() - last < THROTTLE_MS) return [];
  lastRun.set(workspaceId, now.getTime());

  const candidates: Candidate[] = await prisma.mobileAutomationJob.findMany({
    where: {
      workspaceId, action: "POST_THREAD_MESSAGE",
      status: { in: ["QUEUED", "FAILED", "WAITING_USER", "RUNNING"] },
      updatedAt: { gte: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000) }
    },
    select: { id: true, status: true, deviceSerial: true, idempotencyKey: true, text: true, scheduledAt: true, createdAt: true, leaseUntil: true },
    take: 200
  });
  const moved: Array<{ jobId: string; from: string; to: string }> = [];
  for (const job of candidates) {
    if (job.status === "RUNNING" && job.leaseUntil && job.leaseUntil > now) continue;
    let message;
    try { message = parseCommentThreadMessage(job.text ?? ""); } catch { continue; }
    if (message.outcome !== "pending") continue; // podría estar publicado: solo se verifica en su móvil
    const threadId = threadIdFromKey(job.idempotencyKey);
    if (!threadId) continue;

    const lastMove = await prisma.mobileAutomationJobEvent.findFirst({
      where: { workspaceId, jobId: job.id, event: REASSIGNED }, orderBy: { createdAt: "desc" }, select: { createdAt: true }
    });
    const since = lastMove?.createdAt ?? job.createdAt;
    const failures = await prisma.mobileAutomationJobEvent.count({
      where: { workspaceId, jobId: job.id, event: { in: FAILURE_EVENTS }, createdAt: { gt: since } }
    });
    const due = job.scheduledAt <= now;
    const offline = job.status === "QUEUED" && due && now.getTime() - Math.max(job.scheduledAt.getTime(), since.getTime()) > THREAD_FAILOVER_OFFLINE_MS
      && !isDeviceOnline(workspaceId, job.deviceSerial, now.getTime());
    if (failures < THREAD_FAILOVER_FAILURES && !offline) continue;

    const threadJobs = await prisma.mobileAutomationJob.findMany({
      where: { workspaceId, action: "POST_THREAD_MESSAGE", idempotencyKey: { startsWith: `thread:${threadId}:` } },
      select: { deviceSerial: true }
    });
    const inThread = new Set(threadJobs.map((row) => row.deviceSerial));
    const busyRows = await prisma.mobileAutomationJob.findMany({
      where: { workspaceId, OR: [{ status: "RUNNING", leaseUntil: { gt: now } }, { status: "QUEUED", scheduledAt: { lte: now } }] },
      select: { deviceSerial: true }
    });
    const busy = new Set(busyRows.map((row) => row.deviceSerial));
    const replacement = phones.find((phone) => phone.active && phone.deviceSerial
      && !inThread.has(phone.deviceSerial) && !busy.has(phone.deviceSerial)
      && isDeviceOnline(workspaceId, phone.deviceSerial, now.getTime()));
    if (!replacement?.deviceSerial) continue;

    const updatedText = serializeCommentThreadMessage({ ...message, author: replacement.label, detail: null });
    const changed = await prisma.mobileAutomationJob.updateMany({
      where: { id: job.id, workspaceId, deviceSerial: job.deviceSerial, status: job.status, text: job.text },
      data: {
        deviceSerial: replacement.deviceSerial, phoneKey: replacement.key, text: updatedText,
        status: "QUEUED", scheduledAt: now, attempts: 0, leaseOwner: null, leaseUntil: null,
        lastError: null, lastErrorCode: null, expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
      }
    });
    if (changed.count !== 1) continue;
    await prisma.mobileAutomationJobEvent.create({
      data: { workspaceId, jobId: job.id, event: REASSIGNED, actorType: "SYSTEM", metadata: { from: job.deviceSerial, to: replacement.deviceSerial, failures, offline } }
    });
    busy.add(replacement.deviceSerial);
    moved.push({ jobId: job.id, from: job.deviceSerial, to: replacement.deviceSerial });
  }
  return moved;
}
