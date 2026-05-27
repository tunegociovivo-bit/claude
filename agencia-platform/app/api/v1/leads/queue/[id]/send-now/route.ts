/**
 * POST /api/v1/leads/queue/[id]/send-now
 *
 * Envía AHORA un mensaje concreto de la cola saltándose ventana horaria,
 * scheduledAt y pacing. Solo para uso manual desde la UI ("⚡ Enviar ahora").
 * Sigue respetando la validación de WhatsApp y la conexión a WAHA/Evolution.
 */

import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { sendMessageById } from "@/lib/leads/send-queue";

export const POST = withApi({ scope: "*" }, async (_req, { api, params }) => {
  const id = (params as any)?.id as string;
  if (!id) throw new ApiError(400, "missing_id", "Falta id");
  const out = await sendMessageById(api.workspaceId, id);
  return NextResponse.json(out);
});
