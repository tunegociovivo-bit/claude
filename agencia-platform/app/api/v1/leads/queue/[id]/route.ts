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
  await prisma.leadMessage.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});

const patchSchema = z.object({
  // Fecha/hora a la que reprogramar el mensaje (ISO). Debe estar en cola.
  scheduledAt: z.string().min(1)
});

export const PATCH = withApi({ scope: "*" }, async (req, { api, params }) => {
  const id = (params as any)?.id as string;
  if (!id) throw new ApiError(400, "missing_id", "Falta id");
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const when = new Date(parsed.data.scheduledAt);
  if (isNaN(when.getTime())) throw new ApiError(400, "bad_date", "Fecha inválida");
  try {
    const out = await rescheduleMessage({ workspaceId: api.workspaceId, id, scheduledAt: when });
    return NextResponse.json({ ok: true, ...out });
  } catch (e: any) {
    throw new ApiError(400, "reschedule_error", e?.message ?? "No se pudo reprogramar");
  }
});
