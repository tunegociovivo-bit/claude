import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

const schema = z
  .object({
    // Si true, solo re-encola los que fallaron por el (falso) "Número sin
    // WhatsApp". Si false/omitido, re-encola TODOS los failed.
    onlyNoWhatsapp: z.boolean().optional(),
    // Reintentar SOLO estos mensajes fallidos (dead-letter, reintento por fila).
    ids: z.array(z.string().min(1)).min(1).max(500).optional()
  })
  .nullable()
  .optional();

/**
 * Re-encola los mensajes en estado "failed" para volver a intentarlos (p.ej.
 * tras corregir el falso negativo de check-exists de WAHA). Resetea intentos
 * y, para los leads que se descartaron por "Número sin WhatsApp", los vuelve a
 * dejar en "pending" y marca el WhatsApp como no comprobado para que el check
 * (ya corregido) se ejecute de nuevo.
 */
export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  const onlyNoWa = parsed.success && parsed.data?.onlyNoWhatsapp === true;
  const onlyIds = parsed.success ? parsed.data?.ids : undefined;

  const where: any = { workspaceId: api.workspaceId, status: "failed" };
  if (onlyNoWa) where.lastError = "Número sin WhatsApp";
  if (onlyIds && onlyIds.length) where.id = { in: onlyIds };

  const failed = await prisma.leadMessage.findMany({
    where,
    select: { id: true, leadId: true }
  });
  if (failed.length === 0) {
    return NextResponse.json({ requeued: 0, leadsReset: 0 });
  }

  const msgIds = failed.map((f) => f.id);
  const leadIds = Array.from(new Set(failed.map((f) => f.leadId).filter(Boolean))) as string[];
  const now = new Date();

  const upd = await prisma.leadMessage.updateMany({
    where: { id: { in: msgIds }, workspaceId: api.workspaceId, status: "failed" },
    data: { status: "queued", sendAttempts: 0, lastError: null, scheduledAt: now }
  });

  // Re-habilita SOLO los leads que el falso "sin WhatsApp" descartó. Resetea
  // la marca de comprobación para que el check corregido vuelva a evaluarlos.
  const leadUpd = await prisma.lead.updateMany({
    where: { id: { in: leadIds }, workspaceId: api.workspaceId, contactStatus: "discarded" },
    data: {
      contactStatus: "pending",
      hasWhatsapp: false,
      whatsappChecked: false,
      whatsappCheckedAt: null
    }
  });

  return NextResponse.json({ requeued: upd.count, leadsReset: leadUpd.count });
});
