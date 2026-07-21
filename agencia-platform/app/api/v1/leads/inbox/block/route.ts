/**
 * POST /api/v1/leads/inbox/block
 * Bloqueo TOTAL de un lead: opt-out permanente por todos sus teléfonos, cancela
 * mensajes en cola, para secuencias/exec-outreach y marca el negocio como
 * "excluded" para que ninguna búsqueda futura lo recontacte.
 *
 * Body: { phone?: string, leadId?: string, reason?: string }
 * (al menos uno de phone/leadId).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { blockLeadCompletely } from "@/lib/leads/optout";

const schema = z
  .object({
    phone: z.string().min(1).optional(),
    leadId: z.string().min(1).optional(),
    reason: z.string().max(300).optional()
  })
  .refine((v) => !!v.phone || !!v.leadId, { message: "Se requiere phone o leadId" });

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const result = await blockLeadCompletely({
    workspaceId: api.workspaceId,
    phone: parsed.data.phone ?? null,
    leadId: parsed.data.leadId ?? null,
    reason: parsed.data.reason ?? "Bloqueado manualmente: no volver a contactar",
    source: "manual"
  });

  return NextResponse.json({ ok: true, ...result });
});
