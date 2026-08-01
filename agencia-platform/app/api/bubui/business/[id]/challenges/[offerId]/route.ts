/**
 * DELETE /api/bubui/business/[id]/challenges/[offerId]
 *
 * Elimina un RETO activo (oferta share_challenge bloqueada) de este negocio.
 * El comercio puede quitar retos que ya no quiere mantener. También libera el
 * reto personalizado (custom-deal) que lo originó, por si quiere reutilizarlo.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";

export const dynamic = "force-dynamic";

export async function DELETE(req: Request, { params }: { params: { id: string; offerId: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized", message: "No autorizado" } }, { status: 401 });
  }

  const offer = await prisma.bubuiOffer.findFirst({
    where: { id: params.offerId, businessId: params.id, source: "share_challenge" },
    select: { id: true }
  });
  if (!offer) {
    return NextResponse.json({ error: { code: "not_found", message: "Reto no encontrado" } }, { status: 404 });
  }

  // Desvincula el reto personalizado que apuntaba a esta oferta (si lo hay), para
  // que su estado quede coherente, y borra la oferta-reto.
  await prisma.bubuiCustomDeal
    .updateMany({ where: { offerId: offer.id }, data: { offerId: null } })
    .catch(() => {});
  await prisma.bubuiOffer.delete({ where: { id: offer.id } }).catch(() => {});

  return NextResponse.json({ ok: true });
}
