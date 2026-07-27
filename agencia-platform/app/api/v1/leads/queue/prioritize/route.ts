/**
 * POST /api/v1/leads/queue/prioritize
 * Reordena la cola por prioridad para que drene con volumen en vez de a goteo:
 *  1. NUNCA contactados primero (slots desde ahora), 2. fuera de cool-down,
 *  3. en cool-down aparcados a su fecha real, 4. opt-out/excluido cancelados.
 * No cambia topes/ventana/pacing: solo el ORDEN.
 */

import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { prioritizeQueue } from "@/lib/leads/send-queue";

export const POST = withApi({ scope: "*" }, async (_req, { api }) => {
  const out = await prioritizeQueue(api.workspaceId);
  return NextResponse.json({ ok: true, ...out });
});
