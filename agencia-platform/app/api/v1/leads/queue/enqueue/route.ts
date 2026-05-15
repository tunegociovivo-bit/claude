/**
 * POST /api/v1/leads/queue/enqueue
 * Body: { leadId, body, templateId? }
 *
 * Encola un mensaje saliente para un lead. Aplica renderTemplate +
 * varyMessage + computeNextSlot.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { enqueueMessage } from "@/lib/leads/send-queue";

const schema = z.object({
  leadId: z.string().min(1),
  body: z.string().min(1),
  templateId: z.string().optional().nullable()
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  try {
    const out = await enqueueMessage({
      workspaceId: api.workspaceId,
      leadId: parsed.data.leadId,
      body: parsed.data.body,
      templateId: parsed.data.templateId ?? null
    });
    return NextResponse.json(out);
  } catch (e: any) {
    if (e?.message === "Lead no encontrado") throw new ApiError(404, "not_found", e.message);
    throw new ApiError(400, "enqueue_error", e?.message ?? "Error encolando");
  }
});
