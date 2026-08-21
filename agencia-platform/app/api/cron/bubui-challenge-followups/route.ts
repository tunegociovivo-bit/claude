import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { cronAuthOk } from "@/lib/cron-auth";
import { alertBusiness } from "@/lib/bubui/business-push";
import { isEmailEnabled, sendEmail } from "@/lib/integrations/email";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!cronAuthOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const due = await prisma.bubuiChallengeParticipant.findMany({
    where: { status: { in: ["registered", "still_pending"] }, nextFollowupAt: { lte: new Date() } },
    take: 200
  });
  let sent = 0;
  for (const participant of due) {
    const [business, friend] = await Promise.all([
      prisma.bubuiBusiness.findUnique({ where: { id: participant.businessId }, select: { name: true, ownerEmail: true } }),
      prisma.bubuiCustomer.findUnique({ where: { id: participant.friendCustomerId }, select: { name: true, phone: true } })
    ]);
    if (!business) continue;
    const who = friend?.name || friend?.phone || "El nuevo cliente";
    const second = participant.status === "still_pending";
    const message = second
      ? `¿${who} ha contratado ya el servicio del reto? Puedes confirmar, enviarle un recordatorio o darlo por perdido.`
      : `Han pasado 24 horas desde el alta de ${who}. ¿Ha contratado el servicio con el descuento del reto?`;
    await alertBusiness(participant.businessId, { type: "challenge_followup", message, pushTitle: "Seguimiento de un reto", link: "/bubui/negocio#retos-activos" });
    if (isEmailEnabled()) {
      await sendEmail({ to: business.ownerEmail, subject: `Seguimiento del reto de ${who}`, text: `${message}\n\nResponde desde Retos activos: https://hub.negociovivo.app/bubui/negocio#retos-activos`, html: `<p>${message}</p><p><a href="https://hub.negociovivo.app/bubui/negocio#retos-activos">Responder en Retos activos</a></p>` }).catch(() => {});
    }
    await prisma.bubuiChallengeParticipant.update({
      where: { id: participant.id },
      data: { status: second ? "followup_pending" : "awaiting_business", followupSentAt: new Date(), nextFollowupAt: null }
    });
    sent++;
  }
  return NextResponse.json({ ok: true, sent });
}
