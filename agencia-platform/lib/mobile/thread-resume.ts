import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@prisma/client";
import { parseCommentThreadMessage, serializeCommentThreadMessage } from "./comment-thread";

type Tx = Prisma.TransactionClient;

export type ResumableThreadJob = {
  id: string;
  status: string;
  scheduledAt: Date;
  leaseUntil: Date | null;
  text: string | null;
  lastErrorCode?: string | null;
};

/** Tiempo sin avances tras el cual una conversación parada se reactiva sola. */
export const THREAD_AUTO_RESUME_IDLE_MS = 10 * 60 * 1000;
/** Reactivaciones automáticas máximas por mensaje (≈ 4 horas insistiendo). */
export const THREAD_AUTO_RESUME_MAX = 24;
const AUTO_RESUME_EVENT = "THREAD_AUTO_RESUMED";
const AUTO_RESUME_THROTTLE_MS = 60 * 1000;
const AUTO_RESUME_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Un mensaje está «parado» si necesita una intervención para volver a intentarse:
 * pendiente de comprobar, fallido, abandonado (ejecución sin latido) o caducado.
 * Con `includeScheduled` también adelanta los programados para más tarde (solo
 * lo hace el botón manual; la reactivación automática respeta los intervalos).
 */
export function isStalledThreadJob(job: ResumableThreadJob, now: Date, includeScheduled: boolean) {
  if (job.status === "WAITING_USER" || job.status === "FAILED") return true;
  if (job.status === "RUNNING") return !job.leaseUntil || job.leaseUntil <= now;
  if (job.status === "CANCELLED") return job.lastErrorCode === "expired";
  return includeScheduled && job.status === "QUEUED" && job.scheduledAt > now;
}

export function threadIdFromKey(idempotencyKey: string): string | null {
  const match = /^thread:([^:]+):/.exec(idempotencyKey);
  return match ? match[1] : null;
}

/** Vuelve a poner en cola los mensajes parados. Un envío incierto solo se verifica. */
export async function reactivateThreadJobs(tx: Tx, input: {
  workspaceId: string;
  jobs: ResumableThreadJob[];
  now: Date;
  includeScheduled: boolean;
  actorType: "USER" | "SYSTEM";
  actorId?: string | null;
  event: string;
}) {
  let reactivated = 0;
  for (const job of input.jobs) {
    if (!isStalledThreadJob(job, input.now, input.includeScheduled)) continue;
    let recoveryText: string | null = null;
    if (job.status === "RUNNING") {
      try {
        const message = parseCommentThreadMessage(job.text ?? "");
        if (message.sendProtocol !== "checkpoint-v1") {
          recoveryText = serializeCommentThreadMessage({ ...message, outcome: "review", detail: "Ejecución interrumpida: verificar antes de volver a enviar." });
        }
      } catch { /* texto dañado: se reintenta tal cual */ }
    }
    await tx.mobileAutomationJob.update({
      where: { id: job.id },
      data: {
        status: "QUEUED", scheduledAt: input.now, attempts: 0, leaseOwner: null, leaseUntil: null,
        lastError: null, lastErrorCode: null,
        ...(recoveryText ? { text: recoveryText } : {}),
        expiresAt: new Date(input.now.getTime() + 7 * 24 * 60 * 60 * 1000)
      }
    });
    await tx.mobileAutomationJobEvent.create({
      data: { workspaceId: input.workspaceId, jobId: job.id, event: input.event, actorType: input.actorType, actorId: input.actorId ?? null, metadata: { fromStatus: job.status } }
    });
    reactivated += 1;
  }
  return reactivated;
}

const lastAutoResume = new Map<string, number>();

/**
 * Reactivación automática: si un mensaje de una conversación lleva parado más de
 * {@link THREAD_AUTO_RESUME_IDLE_MS} sin avances, se vuelve a poner en cola igual
 * que con «Reactivar y continuar», hasta {@link THREAD_AUTO_RESUME_MAX} veces.
 * Se ejecuta desde el claim de los móviles (como mucho una vez por minuto).
 */
export async function autoResumeStalledThreads(workspaceId: string, now = new Date(), options: { force?: boolean } = {}) {
  const last = lastAutoResume.get(workspaceId) ?? 0;
  if (!options.force && now.getTime() - last < AUTO_RESUME_THROTTLE_MS) return 0;
  lastAutoResume.set(workspaceId, now.getTime());
  const idleBefore = new Date(now.getTime() - THREAD_AUTO_RESUME_IDLE_MS);
  const candidates = await prisma.mobileAutomationJob.findMany({
    where: {
      workspaceId,
      action: "POST_THREAD_MESSAGE",
      status: { in: ["WAITING_USER", "FAILED", "RUNNING", "CANCELLED"] },
      updatedAt: { lte: idleBefore, gte: new Date(now.getTime() - AUTO_RESUME_LOOKBACK_MS) }
    },
    select: { id: true, status: true, scheduledAt: true, leaseUntil: true, text: true, lastErrorCode: true },
    take: 100
  });
  const stalled = candidates.filter((job) => isStalledThreadJob(job, now, false));
  if (!stalled.length) return 0;
  const counts = await prisma.mobileAutomationJobEvent.groupBy({
    by: ["jobId"],
    where: { workspaceId, event: AUTO_RESUME_EVENT, jobId: { in: stalled.map((job) => job.id) } },
    _count: { _all: true }
  });
  const used = new Map(counts.map((row) => [row.jobId, row._count._all]));
  const eligible = stalled.filter((job) => (used.get(job.id) ?? 0) < THREAD_AUTO_RESUME_MAX);
  if (!eligible.length) return 0;
  return prisma.$transaction(async (tx) => {
    // Releer dentro de la transacción: solo se tocan los que siguen parados.
    const fresh = await tx.mobileAutomationJob.findMany({
      where: { workspaceId, id: { in: eligible.map((job) => job.id) }, updatedAt: { lte: idleBefore } },
      select: { id: true, status: true, scheduledAt: true, leaseUntil: true, text: true, lastErrorCode: true }
    });
    return reactivateThreadJobs(tx, { workspaceId, jobs: fresh, now, includeScheduled: false, actorType: "SYSTEM", event: AUTO_RESUME_EVENT });
  }, { isolationLevel: "Serializable" });
}

export function resetAutoResumeThrottleForTests() { lastAutoResume.clear(); }
