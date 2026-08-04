/**
 * Módulo Empleos — cola de revisión.
 *
 *  GET  → lista los emails redactados que esperan aprobación manual (modo review)
 *         + cuántas empresas de la fuente jobs se quedaron sin email de contacto.
 *  POST → acción en LOTE sobre los seleccionados:
 *         { action: "approve", items: [{ id, subject?, body? }] } → envía cada uno
 *         { action: "reject",  items: [{ id }] }                   → descarta cada uno
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { listPendingReview, approveExecOutreach, rejectExecOutreach } from "@/lib/leads/exec-outreach";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const items = await listPendingReview(api.workspaceId);
  // Empresas de la fuente jobs sin email extraíble → no se les puede enviar.
  // Informativo para que el usuario sepa por qué no aparecen todas las ofertas.
  let noEmailCount = 0;
  try {
    noEmailCount = await prisma.lead.count({
      where: {
        workspaceId: api.workspaceId,
        email: null,
        contactStatus: { in: ["pending", "excluded"] },
        rawData: { path: ["source"], equals: "jobs" }
      }
    });
  } catch {
    noEmailCount = 0;
  }
  return NextResponse.json({ items, noEmailCount });
});

const bulkSchema = z.object({
  action: z.enum(["approve", "reject"]),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        subject: z.string().max(300).optional(),
        body: z.string().max(8000).optional()
      })
    )
    .min(1)
    .max(200)
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const parsed = bulkSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const { action, items } = parsed.data;

  let ok = 0;
  const errors: { id: string; message: string }[] = [];

  for (const it of items) {
    try {
      if (action === "reject") {
        await rejectExecOutreach(api.workspaceId, it.id);
      } else {
        await approveExecOutreach(api.workspaceId, it.id, { subject: it.subject, body: it.body });
      }
      ok++;
    } catch (e: any) {
      errors.push({ id: it.id, message: String(e?.message ?? e) });
    }
  }

  return NextResponse.json({ ok, failed: errors.length, errors, action });
});
