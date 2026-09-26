import { parseConversationBatch } from "@/lib/mobile/facebook-conversations";
import { isPageFollowBatchText, parsePageFollowBatch, samePageFollowTargets } from "@/lib/mobile/page-follow-batch";
import { isCommentThreadText, parseCommentThreadMessage, sameThreadSlot, serializeCommentThreadMessage } from "@/lib/mobile/comment-thread";
import type { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";

const DEFAULT_POLICY = {
  enabled: true,
  maxDailyPerDevice: 20,
  minIntervalSeconds: 60,
  allowedStartHour: 7,
  allowedEndHour: 23,
  timezone: "Europe/Madrid"
};

function localHour(date: Date, timezone: string): number {
  try {
    const hour = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date).find((part) => part.type === "hour")?.value;
    return Number(hour ?? date.getUTCHours());
  } catch {
    return date.getUTCHours();
  }
}

function insideAllowedHours(hour: number, start: number, end: number): boolean {
  if (start === end) return true;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export async function claimNextMobileAutomationJob(input: {
  workspaceId: string;
  deviceSerial: string;
  executorSessionId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const storedPolicy = await tx.mobileAutomationPolicy.findUnique({
      where: { workspaceId: input.workspaceId }
    });
    const policy = storedPolicy ?? DEFAULT_POLICY;
    if (!policy.enabled) return null;
    if (!insideAllowedHours(
      localHour(now, policy.timezone),
      policy.allowedStartHour,
      policy.allowedEndHour
    )) return null;

    const preparedSince = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const preparedCount = await tx.mobileAutomationJob.count({
      where: {
        workspaceId: input.workspaceId,
        deviceSerial: input.deviceSerial,
        preparedAt: { gte: preparedSince }
      }
    });
    if (preparedCount >= policy.maxDailyPerDevice) return null;

    const lastPrepared = await tx.mobileAutomationJob.findFirst({
      where: {
        workspaceId: input.workspaceId,
        deviceSerial: input.deviceSerial,
        preparedAt: { not: null }
      },
      orderBy: { preparedAt: "desc" },
      select: { preparedAt: true }
    });
    if (
      lastPrepared?.preparedAt
      && now.getTime() - lastPrepared.preparedAt.getTime() < policy.minIntervalSeconds * 1000
    ) return null;

    const candidates = await tx.mobileAutomationJob.findMany({
      where: {
        workspaceId: input.workspaceId,
        deviceSerial: input.deviceSerial,
        scheduledAt: { lte: now },
        OR: [
          { status: "QUEUED" },
          { status: "RUNNING", leaseUntil: { lt: now } },
          { status: "RUNNING", leaseOwner: input.executorSessionId }
        ]
      },
      orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
      take: 20
    });

    for (const candidate of candidates) {
      if (candidate.expiresAt && candidate.expiresAt <= now) {
        await tx.mobileAutomationJob.update({
          where: { id: candidate.id },
          data: { status: "CANCELLED", lastErrorCode: "expired", lastError: "El trabajo caducó antes de ejecutarse" }
        });
        await tx.mobileAutomationJobEvent.create({
          data: {
            workspaceId: input.workspaceId,
            jobId: candidate.id,
            event: "EXPIRED",
            actorType: "SYSTEM"
          }
        });
        continue;
      }
      let refreshedText: string | null = null;
      if (candidate.action === "POST_THREAD_MESSAGE") {
        const gate = await threadMessageGate(tx, input.workspaceId, candidate.text);
        if (gate.state === "wait") continue;
        if (gate.state === "cancel") {
          await tx.mobileAutomationJob.update({
            where: { id: candidate.id },
            data: { status: "CANCELLED", leaseOwner: null, leaseUntil: null, lastErrorCode: "thread_parent_missing", lastError: gate.reason }
          });
          await tx.mobileAutomationJobEvent.create({
            data: { workspaceId: input.workspaceId, jobId: candidate.id, event: "CANCEL", actorType: "SYSTEM", metadata: { reason: gate.reason } }
          });
          continue;
        }
        refreshedText = gate.text;
      }
      const isFacebookGroupBatch = [
        "DISCOVER_FACEBOOK_GROUPS",
        "JOIN_FACEBOOK_GROUP_BATCH",
        "DISCOVER_FACEBOOK_CONVERSATIONS",
        "REPLY_FACEBOOK_CONVERSATIONS",
        "FOLLOW_PAGES",
        "POST_THREAD_MESSAGE"
      ].includes(candidate.action);
      const leaseUntil = new Date(now.getTime() + (isFacebookGroupBatch ? 10 * 60_000 : 60_000));
      const claimed = await tx.mobileAutomationJob.updateMany({
        where: {
          id: candidate.id,
          workspaceId: input.workspaceId,
          OR: [
            { status: "QUEUED" },
            { status: "RUNNING", leaseUntil: { lt: now } },
            { status: "RUNNING", leaseOwner: input.executorSessionId }
          ]
        },
        data: {
          status: "RUNNING",
          leaseOwner: input.executorSessionId,
          leaseUntil,
          attempts: { increment: 1 },
          lastError: null,
          lastErrorCode: null,
          ...(refreshedText ? { text: refreshedText } : {})
        }
      });
      if (claimed.count !== 1) continue;
      await tx.mobileAutomationJobEvent.create({
        data: {
          workspaceId: input.workspaceId,
          jobId: candidate.id,
          event: "CLAIMED",
          actorType: "BROWSER",
          actorId: input.executorSessionId,
          metadata: { leaseUntil: leaseUntil.toISOString() }
        }
      });
      return { ...candidate, ...(refreshedText ? { text: refreshedText } : {}), status: "RUNNING", leaseOwner: input.executorSessionId, leaseUntil };
    }
    return null;
  }, { isolationLevel: "Serializable" });
}

const THREAD_PENDING = ["PENDING_APPROVAL", "QUEUED", "RUNNING", "WAITING_USER"];
const THREAD_DEAD = ["REJECTED", "CANCELLED"];

/**
 * Orden de la conversación: un mensaje espera a que el anterior termine y, si es
 * una respuesta, a que el mensaje al que responde esté publicado (COMPLETED).
 * Si ese mensaje se rechazó o falló, la respuesta se cancela.
 */
export async function threadMessageGate(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  text: string | null
): Promise<{ state: "ready"; text: string | null } | { state: "wait" } | { state: "cancel"; reason: string }> {
  let message;
  try { message = parseCommentThreadMessage(text ?? ""); }
  catch { return { state: "cancel", reason: "El mensaje de la conversación no es válido." }; }
  const ids = [message.previousJobId, message.parentJobId].filter((id): id is string => Boolean(id));
  const related = ids.length ? await tx.mobileAutomationJob.findMany({
    where: { workspaceId, id: { in: ids } },
    select: { id: true, status: true, text: true }
  }) : [];
  const previous = related.find((job) => job.id === message.previousJobId);
  if (previous && THREAD_PENDING.includes(previous.status)) return { state: "wait" };
  if (!message.parentJobId) return { state: "ready", text: null };
  const parent = related.find((job) => job.id === message.parentJobId);
  // Un padre FAILED puede reintentarse o marcarse como publicado: la respuesta espera.
  if (!parent || THREAD_DEAD.includes(parent.status)) {
    return { state: "cancel", reason: "El mensaje al que responde no se ha publicado; esta respuesta se ha cancelado." };
  }
  if (parent.status !== "COMPLETED") return { state: "wait" };
  // El texto del padre pudo editarse al aprobarlo: la respuesta debe buscar el texto publicado.
  try {
    const parentText = parseCommentThreadMessage(parent.text ?? "").text;
    if (parentText === message.replyToText) return { state: "ready", text: null };
    return { state: "ready", text: serializeCommentThreadMessage({ ...message, replyToText: parentText }) };
  } catch {
    return { state: "ready", text: null };
  }
}

export async function reportMobileAutomationResult(input: {
  workspaceId: string;
  jobId: string;
  executorSessionId: string;
  outcome: "PREPARED" | "DISCOVERED" | "COMPLETED" | "PARTIAL" | "FAILED";
  resultText?: string;
  errorCode?: string;
  error?: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const job = await tx.mobileAutomationJob.findFirst({
      where: { id: input.jobId, workspaceId: input.workspaceId }
    });
    if (!job) throw new ApiError(404, "job_not_found", "El trabajo ya no existe");
    if (job.status !== "RUNNING" || job.leaseOwner !== input.executorSessionId) {
      throw new ApiError(409, "lease_lost", "Esta pestaña ya no posee el trabajo");
    }

    if (input.outcome === "DISCOVERED" && !["DISCOVER_FACEBOOK_GROUPS", "DISCOVER_FACEBOOK_CONVERSATIONS"].includes(job.action)) {
      throw new ApiError(409, "invalid_result", "Este trabajo no esperaba resultados de grupos");
    }
    if (["COMPLETED", "PARTIAL"].includes(input.outcome) && !["JOIN_FACEBOOK_GROUP_BATCH", "REPLY_FACEBOOK_CONVERSATIONS", "FOLLOW_PAGES", "POST_THREAD_MESSAGE"].includes(job.action)) {
      throw new ApiError(409, "invalid_result", "Este trabajo no esperaba solicitudes de grupos");
    }
    if (["DISCOVERED", "COMPLETED", "PARTIAL"].includes(input.outcome) && !input.resultText) {
      throw new ApiError(400, "missing_result", "Falta el resultado del lote de grupos");
    }

    if (job.action === "POST_THREAD_MESSAGE" && input.resultText) {
      let same = false;
      try { same = sameThreadSlot(parseCommentThreadMessage(job.text ?? ""), parseCommentThreadMessage(input.resultText)) && parseCommentThreadMessage(job.text ?? "").text === parseCommentThreadMessage(input.resultText).text; } catch { same = false; }
      if (!same) throw new ApiError(400, "invalid_result", "El resultado no corresponde al mensaje aprobado.");
    } else if (input.resultText && isCommentThreadText(input.resultText)) {
      throw new ApiError(400, "invalid_result", "Este trabajo no esperaba un mensaje de conversación.");
    } else if (job.action === "FOLLOW_PAGES" && input.resultText) {
      let result, original;
      try { result = parsePageFollowBatch(input.resultText); original = parsePageFollowBatch(job.text ?? ""); }
      catch { throw new ApiError(400, "invalid_result", "El lote de páginas no es válido."); }
      if (!samePageFollowTargets(original, result)) throw new ApiError(400, "invalid_result", "El resultado no corresponde a las páginas del encargo.");
    } else if (input.resultText && isPageFollowBatchText(input.resultText)) {
      throw new ApiError(400, "invalid_result", "Este trabajo no esperaba un lote de páginas.");
    } else if (input.resultText && job.action.endsWith("FACEBOOK_CONVERSATIONS")) {
      const result = parseConversationBatch(input.resultText);
      const original = parseConversationBatch(job.text ?? "");
      if (JSON.stringify(result.config) !== JSON.stringify(original.config)) throw new ApiError(400, "invalid_result", "El alcance de la búsqueda ha cambiado.");
      if (job.action === "REPLY_FACEBOOK_CONVERSATIONS") {
        const identity = (items: typeof result.candidates) => items.map(({ outcome: _o, detail: _d, ...item }) => item);
        if (JSON.stringify(identity(result.candidates)) !== JSON.stringify(identity(original.candidates))) throw new ApiError(400, "invalid_result", "El resultado no corresponde a las respuestas aprobadas.");
      }
    } else if (input.resultText && JSON.parse(input.resultText)?.kind === "facebook_conversations") {
      throw new ApiError(400, "invalid_result", "Este trabajo no esperaba conversaciones.");
    }
    if (input.outcome === "DISCOVERED") {
      const data = {
        action: job.action === "DISCOVER_FACEBOOK_CONVERSATIONS" ? "REPLY_FACEBOOK_CONVERSATIONS" : "JOIN_FACEBOOK_GROUP_BATCH",
        status: "PENDING_APPROVAL",
        text: input.resultText,
        leaseOwner: null,
        leaseUntil: null,
        lastError: null,
        lastErrorCode: null
      };
      const changed = await tx.mobileAutomationJob.updateMany({
        where: {
          id: job.id,
          workspaceId: input.workspaceId,
          status: "RUNNING",
          leaseOwner: input.executorSessionId
        },
        data
      });
      if (changed.count !== 1) {
        throw new ApiError(409, "lease_lost", "Esta pestaña ya no posee el trabajo");
      }
      await tx.mobileAutomationJobEvent.create({
        data: {
          workspaceId: input.workspaceId,
          jobId: job.id,
          event: job.action === "DISCOVER_FACEBOOK_CONVERSATIONS" ? "CONVERSATIONS_DISCOVERED" : "GROUPS_DISCOVERED",
          actorType: "BROWSER",
          actorId: input.executorSessionId
        }
      });
      return { ...job, ...data };
    }

    if (input.outcome === "COMPLETED" || input.outcome === "PARTIAL") {
      const partial = input.outcome === "PARTIAL";
      const data = {
        status: partial ? "WAITING_USER" : "COMPLETED",
        text: input.resultText ?? job.text,
        preparedAt: now,
        completedAt: partial ? job.completedAt : now,
        leaseOwner: null,
        leaseUntil: null,
        lastError: partial ? input.error?.slice(0, 1000) || "Parte del lote necesita revisión manual." : null,
        lastErrorCode: partial ? input.errorCode?.slice(0, 120) || "partial_group_batch" : null
      };
      const changed = await tx.mobileAutomationJob.updateMany({
        where: {
          id: job.id,
          workspaceId: input.workspaceId,
          status: "RUNNING",
          leaseOwner: input.executorSessionId
        },
        data
      });
      if (changed.count !== 1) {
        throw new ApiError(409, "lease_lost", "Esta pestaña ya no posee el trabajo");
      }
      await tx.mobileAutomationJobEvent.create({
        data: {
          workspaceId: input.workspaceId,
          jobId: job.id,
          event: job.action === "POST_THREAD_MESSAGE" ? (partial ? "THREAD_MESSAGE_REVIEW" : "THREAD_MESSAGE_SENT") : job.action === "FOLLOW_PAGES" ? (partial ? "PAGE_FOLLOW_PARTIAL" : "PAGE_FOLLOW_COMPLETED") : partial ? "GROUP_BATCH_PARTIAL" : "GROUP_BATCH_COMPLETED",
          actorType: "BROWSER",
          actorId: input.executorSessionId
        }
      });
      return { ...job, ...data };
    }

    if (input.outcome === "PREPARED") {
      const data = {
        status: "WAITING_USER",
        preparedAt: now,
        leaseOwner: null,
        leaseUntil: null,
        lastError: null,
        lastErrorCode: null
      };
      const changed = await tx.mobileAutomationJob.updateMany({
        where: {
          id: job.id,
          workspaceId: input.workspaceId,
          status: "RUNNING",
          leaseOwner: input.executorSessionId
        },
        data
      });
      if (changed.count !== 1) {
        throw new ApiError(409, "lease_lost", "Esta pestaña ya no posee el trabajo");
      }
      await tx.mobileAutomationJobEvent.create({
        data: {
          workspaceId: input.workspaceId,
          jobId: job.id,
          event: "PREPARED",
          actorType: "BROWSER",
          actorId: input.executorSessionId
        }
      });
      return { ...job, ...data };
    }

    const canRetry = input.errorCode !== "facebook_navigation_failed" && job.attempts < job.maxAttempts;
    const retryDelay = Math.min(300, 15 * 2 ** Math.max(0, job.attempts - 1));
    const data = {
      status: canRetry ? "QUEUED" : "FAILED",
      scheduledAt: canRetry ? new Date(now.getTime() + retryDelay * 1000) : job.scheduledAt,
      leaseOwner: null,
      leaseUntil: null,
      lastErrorCode: input.errorCode?.slice(0, 120) || "execution_failed",
      lastError: input.error?.slice(0, 1000) || "No se pudo preparar la acción"
    };
    const changed = await tx.mobileAutomationJob.updateMany({
      where: {
        id: job.id,
        workspaceId: input.workspaceId,
        status: "RUNNING",
        leaseOwner: input.executorSessionId
      },
      data
    });
    if (changed.count !== 1) {
      throw new ApiError(409, "lease_lost", "Esta pestaña ya no posee el trabajo");
    }
    await tx.mobileAutomationJobEvent.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: job.id,
        event: canRetry ? "RETRY_SCHEDULED" : "FAILED",
        actorType: "BROWSER",
        actorId: input.executorSessionId,
        metadata: { attempt: job.attempts }
      }
    });
    return { ...job, ...data };
  }, { isolationLevel: "Serializable" });
}

export type MobileAutomationTransaction = Prisma.TransactionClient;
