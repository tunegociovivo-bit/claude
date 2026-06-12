/**
 * Cron — solicitud de reseña en Google ~10 min después de escanear.
 *
 * Para cada compra confirmada hace 10-25 min, cuyo negocio tenga
 * reviewPushEnabled + googlePlaceId y a la que aún no se le haya enviado el
 * aviso (reviewPushedAt null), envía un push invitando a dejar una reseña en
 * Google. El push abre el formulario de reseñas de Google del local. Si el
 * negocio premia las reseñas (reviewRewardPct), se menciona en el mensaje.
 *
 * Idempotencia: reviewPushedAt se marca al enviar (un aviso por compra). La
 * ventana inferior (25 min) evita reenviar si el cron se ejecuta a destiempo.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { notifyBubuiCustomer } from "@/lib/bubui/notify";
import { googleReviewUrl } from "@/lib/bubui/share-offer";

export const dynamic = "force-dynamic";

const DELAY_MIN = 10;
const WINDOW_MIN = 25; // no avisar de compras más viejas que esto

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const upper = new Date(now - DELAY_MIN * 60_000); // escaneadas hace >= 10 min
  const lower = new Date(now - WINDOW_MIN * 60_000); // y <= 25 min

  const due = await prisma.bubuiPurchase.findMany({
    where: {
      status: "confirmed",
      reviewPushedAt: null,
      scannedAt: { gte: lower, lte: upper },
      business: { reviewPushEnabled: true, googlePlaceId: { not: null }, active: true }
    },
    select: {
      id: true,
      customerId: true,
      business: { select: { id: true, name: true, googlePlaceId: true, reviewRewardPct: true } }
    },
    take: 200
  });

  let sent = 0;
  for (const p of due) {
    const placeId = p.business.googlePlaceId;
    if (!placeId) continue;
    // Marca ANTES de enviar para no duplicar si el push tarda o el cron se
    // solapa. Si el marcado falla (carrera), saltamos esta compra.
    const claim = await prisma.bubuiPurchase.updateMany({
      where: { id: p.id, reviewPushedAt: null },
      data: { reviewPushedAt: new Date() }
    });
    if (claim.count === 0) continue;

    const reward = p.business.reviewRewardPct > 0;
    const body = reward
      ? `¿Qué tal en ${p.business.name}? Déjales 5★ en Google y llévate un ${p.business.reviewRewardPct}% extra en tu próxima visita.`
      : `¿Qué tal tu visita a ${p.business.name}? Ayúdales con una reseña de 5★ en Google, se tarda 10 segundos. 🌟`;

    void notifyBubuiCustomer(p.customerId, {
      title: `⭐ Tu opinión sobre ${p.business.name}`,
      body,
      link: googleReviewUrl(placeId),
      tag: `review-req:${p.id}`,
      data: { type: "google_review_request", businessId: p.business.id, purchaseId: p.id, placeId }
    });
    sent++;
  }

  return NextResponse.json({ ok: true, due: due.length, sent });
}
