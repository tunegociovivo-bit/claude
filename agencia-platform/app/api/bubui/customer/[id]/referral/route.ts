/**
 * GET /api/bubui/customer/[id]/referral
 *
 * Datos del programa de afiliados del cliente: su código/enlace, nº de
 * amigos verificados y estado de los hitos (1/3/5) con su recompensa.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ensureReferralCode, countVerifiedReferrals, rewardLabelFor, parseReward, MILESTONES } from "@/lib/bubui/referral";

function displayReward(raw: string): string {
  const { discountPct, label } = parseReward(raw);
  return label ?? `${discountPct}% de descuento`;
}

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const customer = await prisma.bubuiCustomer.findUnique({
    where: { id: params.id },
    select: { id: true, firstBusinessId: true }
  });
  if (!customer) {
    return NextResponse.json({ error: { code: "not_found", message: "Cliente no encontrado" } }, { status: 404 });
  }

  const code = await ensureReferralCode(customer.id);
  const count = await countVerifiedReferrals(customer.id);

  const business = customer.firstBusinessId
    ? await prisma.bubuiBusiness.findUnique({
        where: { id: customer.firstBusinessId },
        select: { name: true, referralEnabled: true, referralReward1: true, referralReward3: true, referralReward5: true }
      })
    : null;

  const milestones = MILESTONES.map((n) => ({
    n,
    reward: displayReward(rewardLabelFor(business, n)),
    unlocked: count >= n
  }));

  // Lista de amigos invitados — primer carácter del nombre + estado. Para
  // el panel visual del cliente (5 checks). Datos mínimos por privacidad.
  const friends = await prisma.bubuiCustomer.findMany({
    where: { referredById: customer.id },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: { name: true, phoneVerified: true, createdAt: true }
  });

  return NextResponse.json({
    code,
    verifiedReferrals: count,
    originBusiness: business?.name ?? null,
    referralEnabled: business ? business.referralEnabled : false,
    milestones,
    nextMilestone: MILESTONES.find((n) => count < n) ?? null,
    friends: friends.map((f) => ({
      initial: (f.name?.trim()?.[0] || "?").toUpperCase(),
      verified: f.phoneVerified,
      joinedAt: f.createdAt
    }))
  });
}
