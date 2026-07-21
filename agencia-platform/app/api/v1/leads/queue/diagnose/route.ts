/**
 * GET /api/v1/leads/queue/diagnose
 * Diagnóstico completo de la cola de envío: evalúa TODOS los gates anti-baneo
 * (pausa, ventana, topes, cool-down, conexión de cada número, enlaces en el
 * opener) y devuelve un veredicto en lenguaje llano de por qué (no) se envía.
 * Reemplaza el ir pulsando "Procesar siguiente" a ciegas.
 */

import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { diagnoseQueue } from "@/lib/leads/send-queue";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const out = await diagnoseQueue(api.workspaceId);
  return NextResponse.json(out);
});
