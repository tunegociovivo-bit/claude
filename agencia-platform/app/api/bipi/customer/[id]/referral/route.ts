/**
 * GET /api/bipi/customer/[id]/referral
 *
 * Datos del programa de afiliados del cliente: su código/enlace, nº de
 * amigos verificados y estado de los hitos (1/3/5) con su recompensa.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ensureReferralCode, countVerifiedReferrals, rewardLabelFor, MILESTONES } from "@/lib/bipi/referral";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const customer = await prisma.bipiCustomer.findUnique({
    where: { id: params.id },
    select: { id: true, firstBusinessId: true }
  });
  if (!customer) {
    return NextResponse.json({ error: { code: "not_found", message: "Cliente no encontrado" } }, { status: 404 });
  }

  const code = await ensureReferralCode(customer.id);
  const count = await countVerifiedReferrals(customer.id);

  const business = customer.firstBusinessId
    ? await prisma.bipiBusiness.findUnique({
        where: { id: customer.firstBusinessId },
        select: { name: true, referralEnabled: true, referralReward1: true, referralReward3: true, referralReward5: true }
      })
    : null;

  const milestones = MILESTONES.map((n) => ({
    n,
    reward: rewardLabelFor(business, n),
    unlocked: count >= n
  }));

  return NextResponse.json({
    code,
    verifiedReferrals: count,
    originBusiness: business?.name ?? null,
    referralEnabled: business ? business.referralEnabled : false,
    milestones,
    nextMilestone: MILESTONES.find((n) => count < n) ?? null
  });
}
