/**
 * Cron — "acción no elegida" de la Mesa Colectiva (~1h después).
 *
 * En la mesa cada comensal elige UNA acción (compartir o reseña) para aplicar
 * el descuento de grupo. ~1h después, a quien tenga ambas acciones disponibles
 * en ese negocio y solo hizo una, le mandamos un push con la OTRA y le
 * guardamos un cupón para su PRÓXIMA visita:
 *   - le falta reseña → cupón de % (mesaReviewBonusPct) + enlace de reseña;
 *   - le falta compartir → oferta-reto (se activa cuando sus amigos se instalen).
 *
 * Idempotencia: BubuiTableParticipant.followupPushedAt se marca al procesar.
 * Ventana inferior (120 min) evita reprocesar aportes viejos.
 *
 * Auth: Bearer ${INTERNAL_CRON_TOKEN | CRON_SECRET}.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { notifyBubuiCustomer } from "@/lib/bubui/notify";
import { cronAuthOk } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

const DELAY_MIN = 60; // avisar a partir de 1h del aporte
const WINDOW_MIN = 120; // no avisar de aportes más viejos que esto

export async function GET(req: NextRequest) {
  if (!cronAuthOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const upper = new Date(now - DELAY_MIN * 60_000);
  const lower = new Date(now - WINDOW_MIN * 60_000);

  // Comensales que aportaron en la mesa hace ~1h y AÚN NO han compartido: les
  // empujamos a invitar amigos (es el único motor de crecimiento — por cada
  // amigo que se da de alta ganan +% en su hucha).
  const due = await prisma.bubuiTableParticipant.findMany({
    where: {
      followupPushedAt: null,
      sharedDone: false,
      contributedAt: { gte: lower, lte: upper },
      session: { business: { mesaEnabled: true, mesaActShare: true, active: true } }
    },
    include: { session: { include: { business: { select: { id: true, name: true } } } } },
    take: 200
  });

  let sent = 0;
  for (const p of due) {
    // Reclama antes de actuar para no duplicar si el cron se solapa.
    const claim = await prisma.bubuiTableParticipant.updateMany({
      where: { id: p.id, followupPushedAt: null },
      data: { followupPushedAt: new Date() }
    });
    if (claim.count === 0) continue;

    const b = p.session.business;
    void notifyBubuiCustomer(p.customerId, {
      title: `🎁 Gana descuento en ${b.name}`,
      body: `Invita a tus amigos a Bubui: por cada uno que se dé de alta sumas un % de descuento para cuando vayas a comer.`,
      link: "bubui://offers",
      tag: `mesa-followup:${p.id}`,
      data: { type: "mesa_followup_invite", participantId: p.id, businessId: b.id, sessionId: p.sessionId }
    });
    sent++;
  }

  return NextResponse.json({ ok: true, due: due.length, sent });
}
