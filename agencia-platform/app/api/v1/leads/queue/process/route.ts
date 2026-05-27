/**
 * POST /api/v1/leads/queue/process
 * Procesa 1 mensaje pendiente de la cola WAHA. Pensado para llamada por
 * cron (cada minuto). Si no hay nada que procesar, devuelve { processed:
 * false }.
 */

import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { processQueueTick } from "@/lib/leads/send-queue";

export const POST = withApi({ scope: "*" }, async (_req, { api }) => {
  const out = await processQueueTick(api.workspaceId);
  return NextResponse.json(out);
});
