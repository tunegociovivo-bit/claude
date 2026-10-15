/**
 * Secuencias de seguimiento por WhatsApp: alta + procesador.
 *
 * Alta: crea/reinicia la asignación y encola el primer paso.
 * Procesador (cada minuto): el siguiente paso solo se encola cuando el
 * mensaje del paso anterior se ha ENVIADO de verdad y ha pasado el retraso
 * de ese siguiente paso, contado desde el envío. Antes se intentaba encolar
 * el paso 2 al minuto de dar de alta (con el paso 1 aún en cola), la cola lo
 * rechazaba por duplicado y la asignación quedaba en pausa: solo salía el
 * primer mensaje.
 */

import { prisma } from "@/lib/db/prisma";
import { enqueueMessage, SENT_STATUSES } from "./send-queue";
import { EMAIL_ONLY_REASON, isEmailOnlyLead } from "./email-only";
import { normalizePhone } from "./waha";
import { looksLikeAutomaticGreeting } from "./auto-greeting";

type StepLike = {
  order: number;
  delayHours?: number | null;
  delayDays?: number | null;
  templateBody: string;
  kind?: string | null;
  stopIfResponded?: boolean | null;
};

/**
 * Pasos en orden y sin duplicados. Importaciones antiguas crearon varias
 * copias del mismo paso (mismo `order`): se usa la primera de cada orden.
 */
export function uniqueSequenceSteps<T extends { order: number }>(steps: T[]): T[] {
  const seen = new Set<number>();
  return [...steps]
    .sort((a, b) => a.order - b.order)
    .filter((step) => {
      if (seen.has(step.order)) return false;
      seen.add(step.order);
      return true;
    });
}

/** Retraso de un paso respecto al envío del paso anterior. */
export function stepDelayMs(step: Pick<StepLike, "delayHours" | "delayDays">): number {
  const hours = (step.delayHours ?? 0) > 0 ? Number(step.delayHours) : Math.max(0, Number(step.delayDays ?? 0)) * 24;
  return Math.max(0, hours) * 60 * 60 * 1000;
}

const SENT = new Set(SENT_STATUSES);
const PENDING = new Set(["queued", "sending"]);
const POLL_MS = 15 * 60 * 1000;
const OTHER_PENDING_RETRY_MS = 60 * 60 * 1000;
const MAX_ENQUEUES_PER_TICK = 10;

export type SequenceDecision =
  | { kind: "wait"; until: Date; reason: string }
  | { kind: "enqueue"; stepIndex: number }
  | { kind: "complete" }
  | { kind: "pause"; reason: string };

/**
 * Qué hacer con una asignación. `currentStep` es el índice (en los pasos sin
 * duplicados) del último paso ya encolado; -1 si aún no se ha encolado
 * ninguno de esta tanda (reactivación).
 */
export function decideNextSequenceAction(input: {
  now: Date;
  currentStep: number;
  stepCount: number;
  nextStepDelayMs: number;
  lastMessage: { status: string; sentAt: Date | null; scheduledAt: Date | null; lastError: string | null } | null;
  hasOtherPendingMessage: boolean;
}): SequenceDecision {
  const { now, lastMessage } = input;
  const nextIndex = input.currentStep + 1;
  if (lastMessage && PENDING.has(lastMessage.status)) {
    const scheduled = lastMessage.scheduledAt ? lastMessage.scheduledAt.getTime() + 2 * 60 * 1000 : 0;
    return { kind: "wait", until: new Date(Math.max(now.getTime() + POLL_MS, scheduled)), reason: "Esperando a que salga el mensaje anterior" };
  }
  if (lastMessage && !SENT.has(lastMessage.status)) {
    const detail = lastMessage.lastError ? `: ${lastMessage.lastError}` : "";
    return { kind: "pause", reason: `El paso ${input.currentStep + 1} no se envió (${lastMessage.status})${detail}`.slice(0, 500) };
  }
  if (nextIndex >= input.stepCount) return { kind: "complete" };
  if (lastMessage?.sentAt) {
    const due = lastMessage.sentAt.getTime() + input.nextStepDelayMs;
    if (due > now.getTime()) return { kind: "wait", until: new Date(due), reason: "Esperando el retraso del siguiente paso" };
  }
  if (input.hasOtherPendingMessage) {
    return { kind: "wait", until: new Date(now.getTime() + OTHER_PENDING_RETRY_MS), reason: "El lead tiene otro mensaje en cola" };
  }
  return { kind: "enqueue", stepIndex: nextIndex };
}

/** Errores de la cola que significan "no volver a escribir a este lead". */
export function isPermanentEnqueueError(message: string): boolean {
  return /opt-out|excluido|descartado|exclusión permanente|solo email|sin teléfono/i.test(message);
}

export function sequenceIdempotencyKey(assignmentId: string, startedAt: Date, stepIndex: number): string {
  return `seq:${assignmentId}:${startedAt.getTime()}:${stepIndex}`;
}

export async function enrollLeadInSequence(opts: {
  workspaceId: string;
  leadId: string;
  sequenceId: string;
}): Promise<{ assignmentId: string; firstMessageId: string | null }> {
  const lead = await prisma.lead.findFirst({
    where: { id: opts.leadId, workspaceId: opts.workspaceId },
    select: { id: true, contactStatus: true, placeId: true, rawData: true, search: { select: { source: true } } }
  });
  if (!lead) throw new Error("Lead no encontrado");
  // Bloqueo temprano: mejor rechazar el enrolamiento entero que crear la
  // asignación y que el paso 0 (WhatsApp) falle después.
  if (isEmailOnlyLead(lead)) throw new Error(EMAIL_ONLY_REASON);
  if (["excluded", "discarded"].includes(lead.contactStatus)) {
    throw new Error("Lead excluido o descartado");
  }

  const seq = await prisma.leadSequence.findFirst({
    where: { id: opts.sequenceId, workspaceId: opts.workspaceId, active: true },
    include: { steps: { orderBy: { order: "asc" } } }
  });
  if (!seq) throw new Error("Secuencia no encontrada o inactiva");
  const steps = uniqueSequenceSteps(seq.steps);
  if (steps.length === 0) throw new Error("Secuencia sin pasos");

  const now = new Date();
  // Upsert por UNIQUE(leadId, sequenceId)
  const assignment = await prisma.leadSequenceAssignment.upsert({
    where: { leadId_sequenceId: { leadId: lead.id, sequenceId: seq.id } },
    create: { leadId: lead.id, sequenceId: seq.id, currentStep: 0, status: "active", startedAt: now, nextRunAt: new Date(now.getTime() + POLL_MS) },
    update: { currentStep: 0, status: "active", startedAt: now, nextRunAt: new Date(now.getTime() + POLL_MS), stoppedReason: null, completedAt: null, lastMessageId: null }
  });

  // Encolar paso 0 inmediatamente
  const step0 = steps[0];
  let firstMessageId: string | null = null;
  try {
    const out = await enqueueMessage({
      workspaceId: opts.workspaceId,
      leadId: lead.id,
      body: step0.templateBody,
      kind: step0.kind === "ranking" ? "ranking" : "text",
      idempotencyKey: sequenceIdempotencyKey(assignment.id, now, 0)
    });
    firstMessageId = out.messageId;
    await prisma.leadSequenceAssignment.update({ where: { id: assignment.id }, data: { lastMessageId: out.messageId } });
  } catch (e: any) {
    // Si no se puede encolar (sin teléfono, opt-out, etc.) marcamos paused
    await prisma.leadSequenceAssignment.update({
      where: { id: assignment.id },
      data: { status: "paused", stoppedReason: e?.message ?? "enqueue_failed" }
    });
  }

  return { assignmentId: assignment.id, firstMessageId };
}

function phonesOf(lead: { phone: string | null; internationalPhone: string | null }): string[] {
  return [...new Set([normalizePhone(lead.internationalPhone), normalizePhone(lead.phone)].filter((phone): phone is string => Boolean(phone)))];
}

/**
 * Procesa las asignaciones activas cuyo `nextRunAt` ha llegado.
 * Pensado para correr cada minuto. Procesa un lote.
 */
export async function processSequencesTick(opts: {
  workspaceId: string;
  batchSize?: number;
}): Promise<{ processed: number; advanced: number; completed: number; waiting: number; paused: number; stopped: number }> {
  const batchSize = Math.max(1, Math.min(opts.batchSize ?? 30, 100));
  const now = new Date();
  const assignments = await prisma.leadSequenceAssignment.findMany({
    where: {
      status: "active",
      lead: { workspaceId: opts.workspaceId },
      OR: [{ nextRunAt: { lte: now } }, { nextRunAt: null }]
    },
    include: {
      sequence: { include: { steps: { orderBy: { order: "asc" } } } },
      lead: { select: { id: true, contactStatus: true, phone: true, internationalPhone: true } }
    },
    orderBy: { nextRunAt: "asc" },
    take: batchSize
  });

  let advanced = 0, completed = 0, waiting = 0, paused = 0, stopped = 0, enqueues = 0;
  for (const a of assignments) {
    try {
      // Reserva: otra réplica no procesa la misma asignación a la vez.
      const claimed = await prisma.leadSequenceAssignment.updateMany({
        where: { id: a.id, status: "active", nextRunAt: a.nextRunAt },
        data: { nextRunAt: new Date(now.getTime() + 10 * 60 * 1000) }
      });
      if (!claimed.count) continue;

      const stop = async (reason: string) => {
        await prisma.leadSequenceAssignment.update({ where: { id: a.id }, data: { status: "stopped", stoppedReason: reason.slice(0, 300), completedAt: new Date() } });
        stopped++;
      };

      if (["client", "excluded", "discarded"].includes(a.lead.contactStatus)) {
        await stop(`lead_${a.lead.contactStatus}`);
        continue;
      }

      const steps = uniqueSequenceSteps(a.sequence.steps);
      const nextStep = steps[a.currentStep + 1];

      // Respuesta real del lead desde que empezó esta tanda (no autorespuestas).
      // La bandeja ya detiene la secuencia al recibirla; esto cubre contactos
      // que llegan sin lead asociado (p. ej. números ocultos de WhatsApp).
      if (nextStep?.stopIfResponded !== false) {
        const phones = phonesOf(a.lead);
        const replies = await prisma.leadInboxMessage.findMany({
          where: {
            workspaceId: opts.workspaceId,
            direction: "in",
            receivedAt: { gt: a.startedAt },
            AND: [
              { OR: [{ leadId: a.leadId }, ...(phones.length ? [{ phoneNormalized: { in: phones } }] : [])] },
              // Sin clasificar cuenta como respuesta real (lado seguro).
              { OR: [{ classification: null }, { classification: { not: "auto_reply" } }] }
            ]
          },
          select: { body: true },
          take: 10
        });
        if (replies.some((reply) => !looksLikeAutomaticGreeting(reply.body))) {
          await stop("respuesta_recibida");
          continue;
        }
      }

      // Mensaje del paso anterior (las asignaciones antiguas no lo guardaban:
      // se toma el último mensaje del lead desde el alta).
      const lastMessage = a.lastMessageId
        ? await prisma.leadMessage.findUnique({ where: { id: a.lastMessageId }, select: { status: true, sentAt: true, scheduledAt: true, lastError: true } })
        : await prisma.leadMessage.findFirst({
          where: { leadId: a.leadId, createdAt: { gte: new Date(a.startedAt.getTime() - 60 * 1000) } },
          orderBy: { createdAt: "desc" },
          select: { status: true, sentAt: true, scheduledAt: true, lastError: true }
        });
      const otherPending = await prisma.leadMessage.findFirst({
        where: { leadId: a.leadId, status: { in: ["queued", "sending"] }, ...(a.lastMessageId ? { id: { not: a.lastMessageId } } : {}) },
        select: { id: true }
      });

      const decision = decideNextSequenceAction({
        now,
        currentStep: a.currentStep,
        stepCount: steps.length,
        nextStepDelayMs: nextStep ? stepDelayMs(nextStep) : 0,
        lastMessage,
        hasOtherPendingMessage: Boolean(otherPending)
      });

      if (decision.kind === "complete") {
        await prisma.leadSequenceAssignment.update({ where: { id: a.id }, data: { status: "completed", completedAt: new Date(), nextRunAt: null } });
        completed++;
        continue;
      }
      if (decision.kind === "pause") {
        await prisma.leadSequenceAssignment.update({ where: { id: a.id }, data: { status: "paused", stoppedReason: decision.reason } });
        paused++;
        continue;
      }
      if (decision.kind === "wait" || enqueues >= MAX_ENQUEUES_PER_TICK) {
        const until = decision.kind === "wait" ? decision.until : new Date(now.getTime() + 60 * 1000);
        await prisma.leadSequenceAssignment.update({ where: { id: a.id }, data: { nextRunAt: until } });
        waiting++;
        continue;
      }

      const step = steps[decision.stepIndex];
      enqueues++;
      try {
        const out = await enqueueMessage({
          workspaceId: opts.workspaceId,
          leadId: a.leadId,
          body: step.templateBody,
          kind: step.kind === "ranking" ? "ranking" : "text",
          idempotencyKey: sequenceIdempotencyKey(a.id, a.startedAt, decision.stepIndex)
        });
        await prisma.leadSequenceAssignment.update({
          where: { id: a.id },
          data: { currentStep: decision.stepIndex, lastMessageId: out.messageId, nextRunAt: new Date(now.getTime() + POLL_MS), stoppedReason: null }
        });
        advanced++;
      } catch (e: any) {
        const message = String(e?.message ?? "enqueue_failed");
        if (/ya hay un mensaje en cola/i.test(message)) {
          await prisma.leadSequenceAssignment.update({ where: { id: a.id }, data: { nextRunAt: new Date(now.getTime() + OTHER_PENDING_RETRY_MS) } });
          waiting++;
        } else if (isPermanentEnqueueError(message)) {
          await stop(message);
        } else {
          await prisma.leadSequenceAssignment.update({ where: { id: a.id }, data: { status: "paused", stoppedReason: message.slice(0, 500) } });
          paused++;
        }
      }
    } catch (e) {
      console.error("[sequences] error en assignment", a.id, e);
    }
  }

  return { processed: assignments.length, advanced, completed, waiting, paused, stopped };
}
