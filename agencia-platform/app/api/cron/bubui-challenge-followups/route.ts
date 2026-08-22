import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { cronAuthOk } from "@/lib/cron-auth";
import { sendPushToBubuiBusiness } from "@/lib/bubui/business-push";
import { isEmailEnabled, sendEmail } from "@/lib/integrations/email";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!cronAuthOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const due = await prisma.bubuiChallengeParticipant.findMany({
    where: { status: { in: ["registered", "still_pending"] }, nextFollowupAt: { lte: new Date() } },
    orderBy: { nextFollowupAt: "asc" },
    take: 200
  });
  let sent = 0;
  for (const participant of due) {
    const originalStatus = participant.status;
    const claimed = await prisma.bubuiChallengeParticipant.updateMany({
      where: { id: participant.id, status: originalStatus, nextFollowupAt: participant.nextFollowupAt },
      data: { status: "followup_processing" }
    });
    if (claimed.count === 0) continue;
    try {
      const [business, friend] = await Promise.all([
        prisma.bubuiBusiness.findUnique({ where: { id: participant.businessId }, select: { name: true, ownerEmail: true } }),
        prisma.bubuiCustomer.findUnique({ where: { id: participant.friendCustomerId }, select: { name: true, phone: true } })
      ]);
      if (!business) throw new Error("business_not_found");
      const who = friend?.name || friend?.phone || "El nuevo cliente";
      const second = originalStatus === "still_pending";
      const message = second
        ? `¿${who} ha contratado ya el servicio del reto? Puedes confirmar, enviarle un recordatorio o darlo por perdido.`
        : `Ha llegado el momento de revisar el alta de ${who}. ¿Ha contratado el servicio con el descuento del reto?`;
      const finalStatus = second ? "followup_pending" : "awaiting_business";
      // Estado y aviso interno se confirman juntos antes de los canales externos.
      // Así un fallo de email/push nunca vuelve a poner el job en cola ni duplica.
      await prisma.$transaction([
        prisma.bubuiChallengeParticipant.update({
          where: { id: participant.id },
          data: { status: finalStatus, followupSentAt: new Date(), nextFollowupAt: null }
        }),
        prisma.bubuiBusinessNotification.create({
          data: { businessId: participant.businessId, type: "challenge_followup", message }
        })
      ]);
      await sendPushToBubuiBusiness(participant.businessId, {
        title: "Seguimiento de un reto",
        body: message,
        link: "/bubui/negocio#retos-activos",
        tag: `challenge_followup_${participant.id}_${finalStatus}`
      }).catch(() => ({ sent: 0, removed: 0 }));
      if (isEmailEnabled() && business.ownerEmail) {
        await sendEmail({
          to: business.ownerEmail,
          subject: `Seguimiento del reto de ${who}`,
          text: `${message}\n\nResponde Sí, No o Todavía no desde Retos activos: https://hub.negociovivo.app/bubui/negocio#retos-activos`,
          html: `<p>${message}</p><p><a href="https://hub.negociovivo.app/bubui/negocio#retos-activos">Responder Sí, No o Todavía no</a></p>`
        }).catch((error) => console.error("[bubui challenge followup email]", participant.id, error));
      }
      sent++;
    } catch (error) {
      console.error("[bubui challenge followup]", participant.id, error);
      // Solo restauramos si la transacción todavía no confirmó el estado final.
      await prisma.bubuiChallengeParticipant.updateMany({
        where: { id: participant.id, status: "followup_processing" },
        data: { status: originalStatus, nextFollowupAt: participant.nextFollowupAt }
      });
    }
  }
  return NextResponse.json({ ok: true, sent });
}
