/**
 * GET /api/bubui/business/[id]/cross-shopper
 *
 * Devuelve la red de cruces de un negocio:
 *   - hacia quiénes "lleva" clientes (cupones generados por compras en
 *     este negocio y CANJEADOS en otros).
 *   - de quiénes "recibe" clientes (cupones generados en otros negocios y
 *     canjeados aquí).
 *   - tasa de conversión de los cupones que este negocio genera.
 *
 * Esta es la "mina de datos" que diferencia Bubui de cualquier otra
 * herramienta de marketing local: SABER quién manda clientes a quién.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  if (!(await businessTokenAllows(req.headers.get("authorization"), id))) {
    return NextResponse.json({ error: { code: "unauthorized", message: "No autorizado" } }, { status: 401 });
  }
  const business = await prisma.bubuiBusiness.findUnique({ where: { id } });
  if (!business) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });

  // 1. Cupones que ESTE negocio originó (porque alguien hizo una compra aquí).
  const originated = await prisma.bubuiOffer.findMany({
    where: { triggerBusinessId: id },
    select: {
      businessId: true, // ← negocio destino del cupón
      redeemed: true,
      business: { select: { id: true, name: true, category: true } }
    }
  });

  // 2. Cupones que ESTE negocio recibió (clientes que llegaron con cupón
  //    desbloqueado en otro negocio y canjearon aquí).
  const received = await prisma.bubuiOffer.findMany({
    where: { businessId: id, triggerBusinessId: { not: null }, redeemed: true },
    select: {
      triggerBusinessId: true,
      // No tenemos relación inversa con triggerBusiness en el schema actual,
      // así que la resolvemos en una segunda query agregada.
    }
  });

  // Aggregations.
  const outMap = new Map<string, { business: any; total: number; redeemed: number }>();
  for (const o of originated) {
    if (!o.businessId) continue;
    const k = o.businessId;
    if (!outMap.has(k)) outMap.set(k, { business: o.business, total: 0, redeemed: 0 });
    const row = outMap.get(k)!;
    row.total++;
    if (o.redeemed) row.redeemed++;
  }
  const sentTo = Array.from(outMap.values())
    .map((r) => ({
      business: r.business,
      total: r.total,
      redeemed: r.redeemed,
      conversionPct: r.total > 0 ? Math.round((r.redeemed / r.total) * 100) : 0
    }))
    .sort((a, b) => b.redeemed - a.redeemed);

  const inIds = Array.from(new Set(received.map((r) => r.triggerBusinessId).filter(Boolean) as string[]));
  const inBusinesses = inIds.length
    ? await prisma.bubuiBusiness.findMany({
        where: { id: { in: inIds } },
        select: { id: true, name: true, category: true }
      })
    : [];
  const inCountByBiz = new Map<string, number>();
  for (const r of received) {
    if (!r.triggerBusinessId) continue;
    inCountByBiz.set(r.triggerBusinessId, (inCountByBiz.get(r.triggerBusinessId) ?? 0) + 1);
  }
  const receivedFrom = inBusinesses
    .map((b) => ({ business: b, redeemed: inCountByBiz.get(b.id) ?? 0 }))
    .sort((a, b) => b.redeemed - a.redeemed);

  const totalOriginated = originated.length;
  const totalRedeemedByOthers = originated.filter((o) => o.redeemed).length;
  const overallConversion =
    totalOriginated > 0 ? Math.round((totalRedeemedByOthers / totalOriginated) * 100) : 0;

  return NextResponse.json({
    business: { id: business.id, name: business.name, category: business.category },
    summary: {
      cuponesGenerados: totalOriginated,
      canjeadosPorOtros: totalRedeemedByOthers,
      conversionPct: overallConversion,
      cuponesRecibidosCanjeados: received.length
    },
    sentTo, // a qué negocios mandas clientes (con cuántos cupones / conversion)
    receivedFrom // de qué negocios recibes clientes
  });
}
