import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const code = (u.searchParams.get("code") ?? "").toUpperCase();
  const offerId = u.searchParams.get("offerId") ?? "";
  if (!/^[A-Z0-9]{4,12}$/.test(code) || !offerId || offerId.length > 64) {
    return NextResponse.json({ error: { code: "validation" } }, { status: 400 });
  }
  const referrer = await prisma.bubuiCustomer.findUnique({ where: { referralCode: code }, select: { id: true } });
  if (!referrer) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  const offer = await prisma.bubuiOffer.findFirst({
    where: { id: offerId, customerId: referrer.id, source: "share_challenge", redeemed: false, expiresAt: { gt: new Date() } },
    select: { id: true, business: { select: { name: true } } }
  });
  if (!offer) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  const deal = await prisma.bubuiCustomDeal.findFirst({
    where: { offerId: offer.id, claimedByCustomerId: referrer.id, expiresAt: { gt: new Date() } },
    select: { friendDiscountPct: true, friendTitle: true }
  });
  return NextResponse.json({ code, offerId: offer.id, businessName: offer.business.name, friendDiscountPct: deal?.friendDiscountPct ?? 0, friendTitle: deal?.friendTitle ?? null });
}
