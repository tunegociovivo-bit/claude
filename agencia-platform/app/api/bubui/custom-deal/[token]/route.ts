/**
 * GET /api/bubui/custom-deal/[token]
 *
 * Info pública de un reto personalizado (para la página /reto/[token] que abre
 * el cliente). No requiere auth.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const deal = await prisma.bubuiCustomDeal.findUnique({
    where: { token: params.token },
    include: { business: { select: { name: true, city: true, logoUrl: true } } }
  });
  if (!deal) return NextResponse.json({ error: { code: "not_found", message: "Reto no encontrado" } }, { status: 404 });

  const expired = deal.expiresAt.getTime() < Date.now();
  return NextResponse.json({
    token: deal.token,
    businessName: deal.business?.name ?? "el negocio",
    city: deal.business?.city ?? null,
    logoUrl: deal.business?.logoUrl ?? null,
    title: deal.title,
    clientDiscountPct: deal.clientDiscountPct,
    friendsRequired: deal.friendsRequired,
    friendDiscountPct: deal.friendDiscountPct,
    expired,
    claimed: !!deal.claimedByCustomerId,
    claimedByMe: false
  });
}
