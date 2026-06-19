/**
 * GET /api/v1/leads/ranking-candidates?onlyPending=1&excludeManaged=1
 *
 * Leads elegibles para el envío MASIVO de la imagen de posicionamiento:
 *  - con móvil (los que reciben WhatsApp),
 *  - onlyPending: solo contactStatus="pending" (no contactados/clientes/…),
 *  - excludeManaged: excluye los que YA tienen conversación en el inbox
 *    (los que estás gestionando), para no machacar a los antiguos,
 *  - siempre excluye los que ya tienen un mensaje en cola/enviándose.
 * Devuelve el recuento y hasta 2000 ids.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { phoneKind } from "@/lib/leads/phone-type";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const u = new URL(req.url);
  const onlyPending = u.searchParams.get("onlyPending") !== "0";
  const excludeManaged = u.searchParams.get("excludeManaged") !== "0";

  const where: any = {
    workspaceId: api.workspaceId,
    contactStatus: onlyPending ? "pending" : { notIn: ["excluded", "discarded"] },
    // No re-encolar a quien ya tiene un envío en curso.
    messages: { none: { status: { in: ["queued", "sending"] } } }
  };
  if (excludeManaged) {
    // "Gestionado" = ya hay conversación en el inbox (te escribió o le escribiste).
    where.inboxMessages = { none: {} };
  }

  const rows = await prisma.lead.findMany({
    where,
    select: { id: true, phone: true, internationalPhone: true }
  });
  const mobiles = rows.filter((r) => phoneKind(r.phone, r.internationalPhone) === "mobile");
  return NextResponse.json({
    count: mobiles.length,
    ids: mobiles.slice(0, 2000).map((r) => r.id)
  });
});
