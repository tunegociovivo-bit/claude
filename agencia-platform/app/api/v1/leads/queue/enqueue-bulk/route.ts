/**
 * POST /api/v1/leads/queue/enqueue-bulk
 * Body: { leadIds: string[], templateId?: string|null }
 *
 * Encola un mensaje de WhatsApp para varios leads (lanzar campaña). Resuelve
 * la plantilla (la elegida, o la marcada por defecto, o cualquiera) y encola
 * lead por lead.
 *
 * IMPORTANTE: el bucle es SECUENCIAL a propósito. enqueueMessage encadena
 * cada mensaje tras el último programado para ESPACIARLOS (anti-baneo). Si se
 * encolaran en paralelo, todos leerían el mismo "último" y se amontonarían,
 * disparándose en ráfaga (la causa del baneo).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { enqueueMessage } from "@/lib/leads/send-queue";

const schema = z.object({
  leadIds: z.array(z.string().min(1)).min(1).max(500),
  templateId: z.string().min(1).nullable().optional()
});

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  // Resolver plantilla base: la elegida → la default → cualquiera.
  let tpl = parsed.data.templateId
    ? await prisma.leadTemplate.findFirst({
        where: { id: parsed.data.templateId, workspaceId: api.workspaceId }
      })
    : null;
  if (!tpl) {
    tpl = await prisma.leadTemplate.findFirst({
      where: { workspaceId: api.workspaceId, isDefault: true }
    });
  }
  if (!tpl) {
    tpl = await prisma.leadTemplate.findFirst({ where: { workspaceId: api.workspaceId } });
  }
  if (!tpl) {
    throw new ApiError(400, "no_template", "No hay ninguna plantilla. Crea una en la pestaña Plantillas.");
  }

  let ok = 0;
  const skipped: { leadId: string; reason: string }[] = [];

  for (const leadId of parsed.data.leadIds) {
    try {
      await enqueueMessage({
        workspaceId: api.workspaceId,
        leadId,
        body: tpl.body,
        templateId: tpl.id
      });
      ok++;
    } catch (e: any) {
      skipped.push({ leadId, reason: e?.message ?? "error" });
    }
  }

  return NextResponse.json({ ok, skipped, total: parsed.data.leadIds.length, templateName: tpl.name });
});
