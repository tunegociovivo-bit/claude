import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { rescheduleMessage } from "@/lib/leads/send-queue";

export const DELETE = withApi({ scope: "*" }, async (_req, { api, params }) => {
  const id = (params as any)?.id as string;
  if (!id) throw new ApiError(400, "missing_id", "Falta id");
  const msg = await prisma.leadMessage.findFirst({
    where: { id, workspaceId: api.workspaceId },
    select: { id: true, status: true }
  });
  if (!msg) throw new ApiError(404, "not_found", "Mensaje no encontrado");
  if (msg.status === "sending") {
    throw new ApiError(409, "in_flight", "Mensaje en envío; espera a que termine");
  }
  // Los mensajes EN COLA van a la papelera (cancelled) y se pueden restaurar.
  // Los ya procesados (fallidos, bloqueados, enviados) se borran de verdad.
  if (msg.status === "queued") {
    await prisma.leadMessage.update({ where: { id }, data: { status: "cancelled" } });
    return NextResponse.json({ ok: true, soft: true, id });
  }
  await prisma.leadMessage.delete({ where: { id } });
  return NextResponse.json({ ok: true, soft: false, id });
});

const patchSchema = z
  .object({
    // Fecha/hora a la que reprogramar el mensaje (ISO). Debe estar en cola.
    scheduledAt: z.string().min(1).optional(),
    // Número emisor (sesión WAHA): "" = Principal/automático. Solo si no se ha enviado.
    channel: z.string().optional(),
    // Texto del mensaje (o pie de foto si es imagen). Solo mientras esté en cola.
    message: z.string().max(4000).optional()
  })
  .refine((d) => d.scheduledAt !== undefined || d.channel !== undefined || d.message !== undefined, {
    message: "Nada que actualizar"
  });

export const PATCH = withApi({ scope: "*" }, async (req, { api, params }) => {
  const id = (params as any)?.id as string;
  if (!id) throw new ApiError(400, "missing_id", "Falta id");
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  // Cambiar el número emisor del mensaje (mientras no se haya enviado).
  if (parsed.data.channel !== undefined) {
    const channel = parsed.data.channel.trim();
    const msg = await prisma.leadMessage.findFirst({
      where: { id, workspaceId: api.workspaceId },
      select: { id: true, status: true, sentAt: true }
    });
    if (!msg) throw new ApiError(404, "not_found", "Mensaje no encontrado");
    if (msg.status === "sending") throw new ApiError(409, "in_flight", "Mensaje en envío; espera a que termine");
    if (msg.sentAt) throw new ApiError(409, "already_sent", "El mensaje ya se envió; no se puede cambiar el número");
    if (channel) {
      const { getLeadChannels } = await import("@/lib/leads/channels");
      const chans = await getLeadChannels(api.workspaceId);
      if (!chans.some((c) => c.name === channel)) {
        throw new ApiError(400, "bad_channel", `El número "${channel}" no está dado de alta en Ajustes.`);
      }
    }
    await prisma.leadMessage.update({ where: { id }, data: { instanceName: channel || null } });
    if (parsed.data.scheduledAt === undefined) {
      return NextResponse.json({ ok: true, instanceName: channel || null });
    }
  }

  // Editar el texto/pie del mensaje (mientras esté en cola).
  if (parsed.data.message !== undefined) {
    const msg = await prisma.leadMessage.findFirst({
      where: { id, workspaceId: api.workspaceId },
      select: { id: true, status: true }
    });
    if (!msg) throw new ApiError(404, "not_found", "Mensaje no encontrado");
    if (msg.status !== "queued") throw new ApiError(409, "not_queued", "Solo se puede editar el texto de mensajes en cola");
    await prisma.leadMessage.update({ where: { id }, data: { renderedMessage: parsed.data.message } });
    if (parsed.data.scheduledAt === undefined) {
      return NextResponse.json({ ok: true, renderedMessage: parsed.data.message });
    }
  }

  if (parsed.data.scheduledAt !== undefined) {
    const when = new Date(parsed.data.scheduledAt);
    if (isNaN(when.getTime())) throw new ApiError(400, "bad_date", "Fecha inválida");
    try {
      const out = await rescheduleMessage({ workspaceId: api.workspaceId, id, scheduledAt: when });
      return NextResponse.json({ ok: true, ...out });
    } catch (e: any) {
      throw new ApiError(400, "reschedule_error", e?.message ?? "No se pudo reprogramar");
    }
  }

  return NextResponse.json({ ok: true });
});
