import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";
import { notifyBubuiCustomer } from "@/lib/bubui/notify";
import { scheduleChallengeFollowup } from "@/lib/bubui/challenge-lifecycle";

const schema = z.object({ action: z.enum(["yes", "no", "later", "remind", "lost"]) });

export async function POST(req: Request, { params }: { params: { id: string; offerId: string; friendId: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "validation" } }, { status: 400 });
  const participant = await prisma.bubuiChallengeParticipant.findFirst({ where: { offerId: params.offerId, friendCustomerId: params.friendId, businessId: params.id } });
  if (!participant) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });

  const now = new Date();
  const action = parsed.data.action;
  const status = action === "yes" ? "confirmed" : action === "no" ? "declined" : action === "later" ? "still_pending" : action === "lost" ? "lost" : participant.status;
  const business = action === "later" ? await prisma.bubuiBusiness.findUnique({ where: { id: params.id }, select: { challengeFirstFollowupHours: true, challengeRepeatFollowupDays: true } }) : null;
  const nextFollowupAt = action === "later" && business ? scheduleChallengeFollowup("repeat", now, { firstHours: business.challengeFirstFollowupHours, repeatDays: business.challengeRepeatFollowupDays }) : null;
  await prisma.bubuiChallengeParticipant.update({
    where: { id: participant.id },
    data: { status, nextFollowupAt, decidedAt: ["yes", "no", "lost"].includes(action) ? now : null, ...(action === "remind" ? { reminderSentAt: now } : {}) }
  });
  if (["yes", "no", "later"].includes(action)) {
    await prisma.bubuiChallengeParticipant.updateMany({
      where: { id: participant.id, contactedAt: null },
      data: { contactedAt: now, contactChannel: "business" }
    });
  }
  if (action === "yes") {
    const [offer, confirmed] = await Promise.all([
      prisma.bubuiOffer.findFirst({ where: { id: params.offerId, businessId: params.id, source: "share_challenge", active: false }, select: { id: true, unlockShares: true } }),
      prisma.bubuiChallengeParticipant.count({ where: { offerId: params.offerId, status: "confirmed" } })
    ]);
    if (offer && confirmed >= offer.unlockShares) await prisma.bubuiOffer.update({ where: { id: offer.id }, data: { active: true } });
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
