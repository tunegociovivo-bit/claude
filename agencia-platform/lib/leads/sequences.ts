/**
 * Sequences: enrolment + processor.
 *
 * Enroll: crea LeadSequenceAssignment, encola el paso 0.
 * Processor: corre cada minuto. Avanza al siguiente paso cuando el
 * mensaje anterior se envió y ha pasado el delay.
 */

import { prisma } from "@/lib/db/prisma";
import { enqueueMessage } from "./send-queue";
import { EMAIL_ONLY_REASON, isEmailOnlyLead } from "./email-only";

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
  if (seq.steps.length === 0) throw new Error("Secuencia sin pasos");

  // Upsert por UNIQUE(leadId, sequenceId)
  const assignment = await prisma.leadSequenceAssignment.upsert({
    where: { leadId_sequenceId: { leadId: lead.id, sequenceId: seq.id } },
    create: {
      leadId: lead.id,
      sequenceId: seq.id,
      currentStep: 0,
      status: "active",
      nextRunAt: new Date()
    },
    update: {
      currentStep: 0,
      status: "active",
      nextRunAt: new Date(),
      stoppedReason: null,
      completedAt: null
    }
  });

  // Encolar paso 0 inmediatamente
  const step0 = seq.steps[0];
  let firstMessageId: string | null = null;
  try {
    const out = await enqueueMessage({
      workspaceId: opts.workspaceId,
      leadId: lead.id,
      body: step0.templateBody,
      kind: (step0 as any).kind === "ranking" ? "ranking" : "text"
    });
    firstMessageId = out.messageId;
  } catch (e: any) {
    // Si no se puede encolar (sin teléfono, opt-out, etc.) marcamos paused
    await prisma.leadSequenceAssignment.update({
      where: { id: assignment.id },
      data: { status: "paused", stoppedReason: e?.message ?? "enqueue_failed" }
    });
  }

  return { assignmentId: assignment.id, firstMessageId };
}

/**
 * Procesa assignments activos: si su nextRunAt llegó y el último mensaje
 * fue enviado correctamente, encola el siguiente paso.
 *
 * Pensado para correr cada minuto. Procesa un batch.
 */
export async function processSequencesTick(opts: {
  workspaceId: string;
  batchSize?: number;
}): Promise<{ processed: number; advanced: number; completed: number }> {
  const batchSize = opts.batchSize ?? 20;
  const assignments = await prisma.leadSequenceAssignment.findMany({
    where: {
      status: "active",
      lead: { workspaceId: opts.workspaceId },
      nextRunAt: { lte: new Date() }
    },
    include: {
      sequence: { include: { steps: { orderBy: { order: "asc" } } } },
      lead: { select: { id: true, contactStatus: true } }
    },
    take: batchSize
  });

  let advanced = 0;
  let completed = 0;
  for (const a of assignments) {
    try {
      if (["responded", "client", "excluded", "discarded"].includes(a.lead.contactStatus)) {
        await prisma.leadSequenceAssignment.update({
          where: { id: a.id },
          data: {
            status: "stopped",
            stoppedReason: `lead_${a.lead.contactStatus}`,
            completedAt: new Date()
          }
        });
        continue;
      }

      const nextIdx = a.currentStep + 1;
      const step = a.sequence.steps[nextIdx];
      if (!step) {
        // Ya está en el último paso → completar
        await prisma.leadSequenceAssignment.update({
          where: { id: a.id },
          data: { status: "completed", completedAt: new Date() }
        });
        completed++;
        continue;
      }

      // Encolar el siguiente paso
      try {
        await enqueueMessage({
          workspaceId: opts.workspaceId,
          leadId: a.leadId,
          body: step.templateBody,
          kind: (step as any).kind === "ranking" ? "ranking" : "text"
        });
        const delayDays = step.delayDays ?? Math.max(1, Math.round(step.delayHours / 24));
        const nextRun = new Date(Date.now() + delayDays * 24 * 60 * 60 * 1000);
        await prisma.leadSequenceAssignment.update({
          where: { id: a.id },
          data: { currentStep: nextIdx, nextRunAt: nextRun }
        });
        advanced++;
      } catch (e: any) {
        await prisma.leadSequenceAssignment.update({
          where: { id: a.id },
          data: { status: "paused", stoppedReason: e?.message ?? "enqueue_failed" }
        });
      }
    } catch (e) {
      console.error("[sequences] error en assignment", a.id, e);
    }
  }

  return { processed: assignments.length, advanced, completed };
}
