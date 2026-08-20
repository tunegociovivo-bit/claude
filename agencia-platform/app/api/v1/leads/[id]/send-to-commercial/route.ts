import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { normalizePhone, sendText } from "@/lib/leads/waha";
import {
  COMMERCIAL_COLUMN,
  COMMERCIAL_PHONE,
  COMMERCIAL_PROJECT,
  commercialLeadDescription,
  findCommercialColumnId
} from "@/lib/leads/commercial-handoff";

export const POST = withApi({ scope: "*", admin: true, rate: "admin" }, async (req, { api, params }) => {
  const leadId = String((params as any)?.id ?? "");
  if (!leadId) throw new ApiError(400, "missing_id", "Falta el identificador del lead.");

  const lead = await prisma.lead.findFirst({
    where: { id: leadId, workspaceId: api.workspaceId },
    select: {
      id: true,
      name: true,
      phone: true,
      website: true,
      province: true,
      rating: true,
      reviewsCount: true,
      score: true,
      urgency: true,
      gmbUrl: true,
      notes: true,
      commercialTaskId: true,
      commercialSentAt: true
    }
  });
  if (!lead) throw new ApiError(404, "not_found", "Lead no encontrado.");

  if (lead.commercialSentAt && lead.commercialTaskId) {
    return NextResponse.json({
      ok: true,
      existing: true,
      taskId: lead.commercialTaskId,
      sentAt: lead.commercialSentAt,
      taskUrl: `/tareas?task=${lead.commercialTaskId}`
    });
  }

  const project = await prisma.project.findFirst({
    where: {
      workspaceId: api.workspaceId,
      name: { equals: COMMERCIAL_PROJECT, mode: "insensitive" },
      archived: false,
      deletedAt: null
    },
    select: { id: true, name: true, kanbanColumns: true }
  });
  if (!project) {
    throw new ApiError(409, "commercial_project_missing", `No existe el proyecto ${COMMERCIAL_PROJECT}.`);
  }

  const status = findCommercialColumnId(project.kanbanColumns);
  if (!status) {
    throw new ApiError(409, "commercial_column_missing", `No existe la columna ${COMMERCIAL_COLUMN} en ${project.name}.`);
  }

  let taskId = lead.commercialTaskId;
  if (taskId) {
    const taskStillExists = await prisma.task.findFirst({
      where: { id: taskId, workspaceId: api.workspaceId, deletedAt: null },
      select: { id: true }
    });
    if (!taskStillExists) taskId = null;
  }

  if (!taskId) {
    const created = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`${api.workspaceId}:commercial-lead:${lead.id}`}))`;
      const freshLead = await tx.lead.findUnique({
        where: { id: lead.id },
        select: { commercialTaskId: true }
      });
      if (freshLead?.commercialTaskId) {
        const existingTask = await tx.task.findFirst({
          where: { id: freshLead.commercialTaskId, workspaceId: api.workspaceId, deletedAt: null },
          select: { id: true }
        });
        if (existingTask) return existingTask;
      }

      const last = await tx.task.aggregate({
        where: { workspaceId: api.workspaceId, projectId: project.id, status, deletedAt: null },
        _max: { order: true }
      });
      const task = await tx.task.create({
        data: {
          workspaceId: api.workspaceId,
          projectId: project.id,
          title: `📈 Lead comercial: ${lead.name}`,
          description: commercialLeadDescription(lead),
          status,
          priority: "HIGH",
          order: (last._max.order ?? -1) + 1,
          customData: {
            source: "lead-commercial-handoff",
            leadId: lead.id,
            leadName: lead.name,
            leadPhone: lead.phone,
            leadUrl: `/admin/leads?lead=${lead.id}`
          } as any
        },
        select: { id: true }
      });
      await tx.lead.update({ where: { id: lead.id }, data: { commercialTaskId: task.id } });
      return task;
    });
    taskId = created.id;
  }

  const recipient = normalizePhone(COMMERCIAL_PHONE);
  if (!recipient) throw new ApiError(500, "invalid_commercial_phone", "El teléfono del comercial no es válido.");

  // Reserva atómica del envío: evita dos WhatsApps si se pulsa desde dos
  // pestañas. Una reserva antigua (>5 min) se puede recuperar tras un fallo.
  const sendingAt = new Date();
  const staleClaim = new Date(sendingAt.getTime() - 5 * 60 * 1000);
  const claim = await prisma.lead.updateMany({
    where: {
      id: lead.id,
      workspaceId: api.workspaceId,
      commercialSentAt: null,
      OR: [{ commercialSendingAt: null }, { commercialSendingAt: { lt: staleClaim } }]
    },
    data: { commercialSendingAt: sendingAt }
  });
  if (claim.count === 0) {
    throw new ApiError(409, "commercial_notification_in_progress", "El aviso al comercial ya se está enviando.");
  }

  const origin = new URL(req.url).origin;
  const taskUrl = `${origin}/tareas?project=${encodeURIComponent(project.id)}&task=${encodeURIComponent(taskId)}`;
  const message = [
    "📈 *Nuevo lead para comercial*",
    "",
    `*Negocio:* ${lead.name}`,
    `*Teléfono:* ${lead.phone ?? "—"}`,
    `*Web:* ${lead.website ?? "—"}`,
    `*Provincia:* ${lead.province ?? "—"}`,
    `*Rating:* ${lead.rating != null ? `${lead.rating} (${lead.reviewsCount} reseñas)` : "—"}`,
    `*Score:* ${lead.score ?? "—"}`,
    `*Urgencia:* ${lead.urgency ?? "—"}`,
    "",
    `Tarea creada en *${COMMERCIAL_PROJECT} → ${COMMERCIAL_COLUMN}*:`,
    taskUrl
  ].join("\n");

  try {
    await sendText({ workspaceId: api.workspaceId, phoneNormalized: recipient, text: message });
  } catch (error: any) {
    console.warn("[lead-commercial-handoff] WhatsApp failed", {
      workspaceId: api.workspaceId,
      leadId: lead.id,
      taskId,
      error: error?.message ?? String(error)
    });
    await prisma.lead.updateMany({
      where: { id: lead.id, workspaceId: api.workspaceId, commercialSendingAt: sendingAt },
      data: { commercialSendingAt: null }
    });
    throw new ApiError(
      502,
      "commercial_whatsapp_failed",
      "La tarea se ha creado, pero el aviso de WhatsApp no pudo enviarse. Pulsa “Reintentar aviso”."
    );
  }

  const sentAt = new Date();
  await prisma.lead.update({
    where: { id: lead.id },
    data: { commercialTaskId: taskId, commercialSendingAt: null, commercialSentAt: sentAt }
  });

  return NextResponse.json({
    ok: true,
    existing: false,
    taskId,
    sentAt,
    taskUrl: `/tareas?project=${project.id}&task=${taskId}`
  });
});
