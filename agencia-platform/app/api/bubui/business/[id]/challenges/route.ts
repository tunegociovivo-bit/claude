/**
 * GET /api/bubui/business/[id]/challenges
 *
 * Lista los clientes con un RETO en marcha (oferta share_challenge bloqueada,
 * sin caducar) de este negocio, con su progreso (amigos traídos / requeridos)
 * y su caducidad. Para el panel "Retos activos" del comercio.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";
import { countVerifiedReferrals, countQualifiedReferrals } from "@/lib/bubui/referral";
import { sharesLeft } from "@/lib/bubui/share-offer";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized", message: "No autorizado" } }, { status: 401 });
  }

  const offers = await prisma.bubuiOffer.findMany({
    where: {
      businessId: params.id,
      source: "share_challenge",
      active: false,
      redeemed: false,
      expiresAt: { gt: new Date() }
    },
    orderBy: { createdAt: "desc" },
    take: 100
  });

  const custIds = [...new Set(offers.map((o) => o.customerId))];
  const customers = await prisma.bubuiCustomer.findMany({
    where: { id: { in: custIds } },
    select: { id: true, name: true, phone: true }
  });
  const cmap = new Map(customers.map((c) => [c.id, c]));

  const items = await Promise.all(
    offers.map(async (o) => {
      const verified = o.unlockRequiresPurchase
        ? await countQualifiedReferrals(o.customerId, params.id)
        : await countVerifiedReferrals(o.customerId);
      const left = sharesLeft({ unlockBaseline: o.unlockBaseline, unlockShares: o.unlockShares }, verified);
      const done = Math.max(0, Math.min(o.unlockShares, verified - o.unlockBaseline));
      const c = cmap.get(o.customerId);
      return {
        offerId: o.id,
        customerId: o.customerId,
        name: c?.name ?? null,
        phone: c?.phone ?? null,
        discountPct: o.discountPct,
        rewardLabel: o.rewardLabel,
        need: o.unlockShares,
        done,
        left,
        requiresPurchase: o.unlockRequiresPurchase,
        expiresAt: o.expiresAt.toISOString(),
        createdAt: o.createdAt.toISOString()
      };
    })
  );

  return NextResponse.json({ items });
}
