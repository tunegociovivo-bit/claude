/**
 * POST /api/v1/leads/bulk-status
 *
 * Cambia masivamente el contactStatus de N leads (bulk actions UI):
 *   - "excluded"  → no se contactarán nunca
 *   - "discarded" → se descartan (no encajan)
 *   - "pending"   → reactivar para contactar
 *
 * Body: { leadIds: string[], contactStatus: "excluded"|"discarded"|"pending", reason?: string }
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const schema = z.object({
  // Hasta 5000 para permitir "Seleccionar todos" sobre búsquedas grandes
  // (p. ej. un sector en toda España). Es un updateMany, así que es barato.
  leadIds: z.array(z.string().min(1)).min(1).max(5000),
  contactStatus: z.enum(["excluded", "discarded", "pending"]),
  reason: z.string().max(200).optional()
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const { leadIds, contactStatus, reason } = parsed.data;

  const notesPrefix =
    contactStatus === "excluded"
      ? "Excluido manualmente"
      : contactStatus === "discarded"
        ? "Descartado manualmente"
        : null;
  const notes = notesPrefix
    ? `${notesPrefix}${reason ? `: ${reason}` : ""}`
    : null;

  const out = await prisma.lead.updateMany({
    where: { id: { in: leadIds }, workspaceId: api.workspaceId },
    data: {
      contactStatus,
      ...(notes !== null ? { notes } : {})
    }
  });

  return NextResponse.json({ updated: out.count });
});
