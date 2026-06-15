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
import { createMesaShareChallenge } from "@/lib/bubui/share-offer";
import { mesaReviewUrl, mesaReviewPlatformLabel } from "@/lib/bubui/table";
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

  const due = await prisma.bubuiTableParticipant.findMany({
    where: {
      followupPushedAt: null,
      contributedAt: { gte: lower, lte: upper },
      // Solo negocios que aceptan AMBAS acciones (hay "otra" que ofrecer).
      session: { business: { mesaEnabled: true, mesaActShare: true, mesaActReview: true, active: true } }
    },
    include: { session: { include: { business: true } } },
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
    const did = { share: p.sharedDone, review: p.reviewDone };
    // La acción que NO eligió (solo si hizo exactamente una).
    const missing: "share" | "review" | null =
      did.share && !did.review ? "review" : did.review && !did.share ? "share" : null;
    if (!missing) continue;

    const days = b.mesaNextVisitDays ?? 15;
    const maxPct = b.mesaMaxPct ?? 20;

    if (missing === "review") {
      const pct = Math.min(b.mesaReviewBonusPct ?? 0, maxPct);
      if (pct <= 0) continue;
      const expiresAt = new Date(now + days * 86_400_000);
      await prisma.bubuiOffer
        .upsert({
          where: { customerId_businessId_triggerBusinessId: { customerId: p.customerId, businessId: b.id, triggerBusinessId: `mesafu:${p.id}` } },
          create: { customerId: p.customerId, businessId: b.id, triggerBusinessId: `mesafu:${p.id}`, discountPct: pct, source: "mesa_followup", active: true, expiresAt },
          update: { discountPct: pct, expiresAt, active: true }
        })
        .catch(() => {});
      const reviewLink = mesaReviewUrl(b);
      void notifyBubuiCustomer(p.customerId, {
        title: `⭐ Te guardamos un ${pct}% en ${b.name}`,
        body: `Deja una reseña en ${mesaReviewPlatformLabel(b)} y tienes un ${pct}% para tu próxima visita (${days} días).`,
        link: reviewLink || "bubui://offers",
        tag: `mesa-followup:${p.id}`,
        data: { type: "mesa_followup_review", participantId: p.id, businessId: b.id, sessionId: p.sessionId }
      });
      sent++;
    } else {
      // Falta compartir → reto: se activa cuando sus amigos se den de alta.
      const pct = b.mesaShareBonusPct ?? 0;
      if (pct <= 0) continue;
      await createMesaShareChallenge({
        customerId: p.customerId,
        sessionId: p.sessionId,
        business: { id: b.id, mesaShareBonusPct: pct },
        friends: p.session.shareFriends
      }).catch(() => {});
      void notifyBubuiCustomer(p.customerId, {
        title: `🎁 +${pct}% extra en ${b.name}`,
        body: `Invita a ${p.session.shareFriends} amigo${p.session.shareFriends === 1 ? "" : "s"} a Bubui: cuando se den de alta, desbloqueas un ${pct}% para tu próxima visita.`,
        link: "bubui://offers",
        tag: `mesa-followup:${p.id}`,
        data: { type: "mesa_followup_share", participantId: p.id, businessId: b.id, sessionId: p.sessionId }
      });
      sent++;
    }
  }

  return NextResponse.json({ ok: true, due: due.length, sent });
}
