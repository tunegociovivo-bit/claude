import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { settlePurchase, PurchaseConflict } from "@/lib/bubui/purchase-settlement";
import { businessTokenAllows } from "@/lib/bubui/auth";
import { notifyBubuiCustomer } from "@/lib/bubui/notify";
import { scheduleChallengeFollowup } from "@/lib/bubui/challenge-lifecycle";
import { unlockShareChallengeOffers } from "@/lib/bubui/share-offer";

const schema = z.object({ action: z.enum(["yes", "no", "later", "remind", "lost"]) });

export async function POST(req: Request, { params }: { params: { id: string; offerId: string; friendId: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id, { requireStoredToken: true }))) return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "validation" } }, { status: 400 });
  const participant = await prisma.bubuiChallengeParticipant.findFirst({ where: { offerId: params.offerId, friendCustomerId: params.friendId, businessId: params.id } });
  if (!participant) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });

  const now = new Date();
  const action = parsed.data.action;
  const welcomeWhere = { customerId: params.friendId, businessId: params.id, source: "referral_welcome", triggerBusinessId: `ref:welcome:${params.offerId}`, redeemed: false };
  const offer = await prisma.bubuiOffer.findFirst({
    where: { id: params.offerId, businessId: params.id, customerId: participant.referrerCustomerId, source: "share_challenge", redeemed: false, expiresAt: { gt: now } },
    select: { id: true }
  });
  if (!offer) return NextResponse.json({ error: { code: "conflict", message: "El reto ha caducado o ya se ha utilizado" } }, { status: 409 });
  if (["confirmed", "declined", "lost"].includes(participant.status)) {
    if (action === "yes" && participant.status === "confirmed") {
      await prisma.bubuiOffer.updateMany({ where: welcomeWhere, data: { redeemed: true, redeemedAt: participant.decidedAt ?? now } });
      await unlockShareChallengeOffers(participant.referrerCustomerId, params.offerId);
      return NextResponse.json({ ok: true, status: participant.status, nextFollowupAt: null });
    }
    return NextResponse.json({ error: { code: "conflict", message: "Esta participación ya está cerrada" } }, { status: 409 });
  }
  const status = action === "yes" ? "confirmed" : action === "no" ? "declined" : action === "later" ? "still_pending" : action === "lost" ? "lost" : participant.status;
  const business = action === "later" ? await prisma.bubuiBusiness.findUnique({ where: { id: params.id }, select: { challengeFirstFollowupHours: true, challengeRepeatFollowupDays: true } }) : null;
  const nextFollowupAt = action === "remind" ? participant.nextFollowupAt : action === "later" && business ? scheduleChallengeFollowup("repeat", now, { firstHours: business.challengeFirstFollowupHours, repeatDays: business.challengeRepeatFollowupDays }) : null;
  let changed;
  try {
    changed = await prisma.$transaction(async (tx) => {
      const result = await tx.bubuiChallengeParticipant.updateMany({
        where: { id: participant.id, status: participant.status, ...(action === "remind" ? { reminderSentAt: null } : {}) },
        data: { status, nextFollowupAt, decidedAt: ["yes", "no", "lost"].includes(action) ? now : null, ...(action === "remind" ? { reminderSentAt: now } : {}) }
      });
      if (result.count && action === "yes") {
        const coupons = await tx.bubuiOffer.findMany({ where: welcomeWhere, select: { id: true } });
        const pending = await tx.bubuiPurchase.findFirst({
          where: { customerId: params.friendId, businessId: params.id, status: "pending", redeemedOfferId: { in: coupons.map(c => c.id) } },
          orderBy: { scannedAt: "asc" }
        });
        if (pending) await settlePurchase(tx, pending);
        await tx.bubuiOffer.updateMany({ where: welcomeWhere, data: { redeemed: true, redeemedAt: now } });
      }
      return result;
    });
  } catch (error) {
    if (error instanceof PurchaseConflict) return NextResponse.json({ error: { code: "conflict", message: error.message } }, { status: 409 });
    throw error;
  }
  if (!changed.count) return NextResponse.json({ error: { code: "conflict", message: "El estado ha cambiado. Actualiza el panel." } }, { status: 409 });
  if (["yes", "no", "later"].includes(action)) {
    await prisma.bubuiChallengeParticipant.updateMany({
      where: { id: participant.id, contactedAt: null },
      data: { contactedAt: now, contactChannel: "business" }
    });
  }
  if (action === "yes") {
    await unlockShareChallengeOffers(participant.referrerCustomerId, params.offerId);
  }

  const friend = await prisma.bubuiCustomer.findUnique({ where: { id: params.friendId }, select: { name: true, phone: true } });
  const who = friend?.name || friend?.phone || "Tu amigo/a";
  if (action === "no" || action === "lost") {
    void notifyBubuiCustomer(participant.referrerCustomerId, {
      title: "Tu reto sigue abierto",
      body: `${who} finalmente no contrató el servicio. Compártelo con otro amigo para completar tu reto.`,
      link: "/", tag: "challenge_friend_declined", bypassDailyCap: true
    });
  } else if (action === "remind") {
    void notifyBubuiCustomer(params.friendId, {
      title: "Tu descuento del reto te espera",
      body: "El negocio te recuerda que todavía puedes disfrutar del servicio con el descuento que te envió tu amigo/a.",
      link: "/", tag: "challenge_friend_reminder", bypassDailyCap: true
    });
  }
  return NextResponse.json({ ok: true, status, nextFollowupAt });
}
