/**
 * Cron — recordatorios de seguimiento del inbox de leads.
 *
 * Avisa cuando llega la hora de un recordatorio puesto en una conversación
 * ("recuérdamelo en 2 días"): notifica a los admins del workspace (panel +
 * push), sube la conversación a estado "followup" y marca el aviso para no
 * repetirlo. Pensado para correr cada 5-15 min.
 *
 * Auth: Bearer INTERNAL_CRON_TOKEN / CRON_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { cronAuthOk } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!cronAuthOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const due = await prisma.leadConversationMeta.findMany({
    where: { followupAt: { not: null, lte: now }, followupNotifiedAt: null },
    take: 200
  });

  let sent = 0;
  for (const c of due) {
    const who = c.displayName || c.realPhone || c.phone;
    const body = `⏰ Toca seguir con ${who}${c.followupNote ? `: ${c.followupNote}` : ""}.`;
    try {
      const admins = await prisma.membership.findMany({
        where: { workspaceId: c.workspaceId, role: "ADMIN" },
        select: { userId: true }
      });
      if (admins.length) {
        await prisma.notification.createMany({
          data: admins.map((a) => ({
            userId: a.userId,
            type: "leads_followup",
            body,
            link: "/admin/leads"
          }))
        });
        const { sendPushToUser } = await import("@/lib/push/web-push");
        await Promise.all(
          admins.map((a) =>
            sendPushToUser(a.userId, {
              title: "Seguimiento de lead",
              body,
              link: "/admin/leads",
              tag: `leads-followup-${c.id}`
            }).catch(() => {})
          )
        );
      }
      // Sube a "followup" y marca el aviso (no repetir).
      await prisma.leadConversationMeta.update({
        where: { id: c.id },
        data: { followupNotifiedAt: now, status: "followup", archived: false }
      });
      sent++;
    } catch (e: any) {
      console.warn("[leads-followups]", e?.message ?? e);
    }
  }

  return NextResponse.json({ ok: true, due: due.length, sent });
}
