/**
 * Cron horario — recordatorio de la oferta-reto a medias.
 *
 * Busca ofertas-reto (source share_challenge) aún BLOQUEADAS, no caducadas y
 * con más de 24h de vida, y empuja al cliente a terminar el reto: "Te faltan
 * N amigos para tu X% en NEGOCIO". Es el empujón que convierte retos
 * abandonados en activaciones (y en usuarios nuevos).
 *
 * Límites anti-spam:
 *   - máx. 1 recordatorio por cliente cada 48h (aunque tenga varios retos);
 *   - máx. 3 recordatorios por oferta en total;
 *   - si tiene varios retos pendientes, se recuerda el más cercano a
 *     completarse (menos amigos restantes; a igualdad, mayor premio).
 *
 * Dedupe vía BubuiPushLog (kind "share_reminder", payload.offerId).
 *
 * Auth: Bearer ${CRON_SECRET}.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { notifyBubuiCustomer } from "@/lib/bubui/notify";
import { countVerifiedReferrals, countQualifiedReferrals } from "@/lib/bubui/referral";
import { sharesLeft } from "@/lib/bubui/share-offer";
import { getChallengeExpiryWarnDays } from "@/lib/bubui/growth-settings";
import { cronAuthOk } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

const MIN_AGE_MS = 24 * 60 * 60 * 1000; // primera vez: a las 24h del scan
const COOLDOWN_MS = 48 * 60 * 60 * 1000; // luego, máx. uno cada 48h
const MAX_PER_OFFER = 3;

export async function GET(req: NextRequest) {
  if (!cronAuthOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = Date.now();

  // ── Aviso de CADUCIDAD inminente ──────────────────────────────────────────
  // Cupones-reto bloqueados que caducan dentro de la ventana configurada por el
  // admin: un único push por cupón (kind "share_expiry") para terminar a tiempo.
  const warnDays = await getChallengeExpiryWarnDays();
  const expirySoonMs = warnDays * 24 * 60 * 60 * 1000;
  let expirySent = 0;
  let expiryDeferred = 0;
  const expiringSoon = await prisma.bubuiOffer.findMany({
    where: {
      source: "share_challenge",
      active: false,
      redeemed: false,
      expiresAt: { gt: new Date(now), lte: new Date(now + expirySoonMs) }
    },
    include: { business: { select: { name: true } } },
    take: 500
  });
  for (const o of expiringSoon) {
    // Dedupe por cupón: si ya hubo aviso de caducidad para ESTE cupón, saltar.
    const sentForThis = await prisma.bubuiPushLog.count({
      where: { customerId: o.customerId, kind: "share_expiry", payload: { path: ["offerId"], equals: o.id } as any }
    }).catch(() => 0);
    if (sentForThis > 0) continue;
    const prize = o.rewardLabel?.trim() || `${o.discountPct}% de descuento`;
    const bizName = o.business?.name ?? "el negocio";
    const daysLeft = Math.max(1, Math.ceil((o.expiresAt.getTime() - now) / 86_400_000));
    const r = await notifyBubuiCustomer(o.customerId, {
      title: `⏳ Tu cupón caduca en ${daysLeft} día${daysLeft === 1 ? "" : "s"}`,
      body: `No pierdas tu ${prize} en ${bizName}. Termina las acciones (invita a amigos o, si ya puedes, reseña/foto) antes de que caduque.`,
      link: "bubui://offers",
      tag: `share-expiry:${o.id}`,
      data: { type: "share_offer_expiring", offerId: o.id, businessId: o.businessId }
    });
    // Solo registramos (y damos por avisado) cuando se entregó. Si el cliente ya
    // llegó a su tope de push del día (r.capped), NO lo marcamos: el cupón sigue
    // sin aviso y este mismo cron lo reintentará cuando la cuota se resetee
    // (al día siguiente). Así el aviso de caducidad se APLAZA en vez de perderse.
    if (r.sent > 0) {
      expirySent++;
      await prisma.bubuiPushLog.create({ data: { customerId: o.customerId, kind: "share_expiry", payload: { offerId: o.id, daysLeft } } }).catch(() => {});
    } else if (r.capped) {
      expiryDeferred++;
    }
  }
  const locked = await prisma.bubuiOffer.findMany({
    where: {
      source: "share_challenge",
      active: false,
      redeemed: false,
      expiresAt: { gt: new Date(now) },
      createdAt: { lte: new Date(now - MIN_AGE_MS) }
    },
    include: { business: { select: { name: true, shareOfferRequiresPurchase: true } } },
    orderBy: { createdAt: "asc" },
    take: 500
  });

  // Agrupa por cliente: un push por cliente y pasada.
  const byCustomer = new Map<string, typeof locked>();
  for (const o of locked) {
    const list = byCustomer.get(o.customerId) ?? [];
    list.push(o);
    byCustomer.set(o.customerId, list);
  }

  let sent = 0;
  for (const [customerId, offers] of byCustomer) {
    // Cooldown por cliente y tope por oferta, con un solo query de logs.
    const logs = await prisma.bubuiPushLog.findMany({
      where: { customerId, kind: "share_reminder" },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true, payload: true }
    });
    if (logs[0] && logs[0].sentAt.getTime() > now - COOLDOWN_MS) continue;
    const remindersFor = (offerId: string) =>
      logs.filter((l) => (l.payload as any)?.offerId === offerId).length;

    const verified = await countVerifiedReferrals(customerId);
    // Retos que exigen compra: recuento por negocio (amigos que ya compraron).
    const qmap = new Map<string, number>();
    const scored = [];
    for (const o of offers) {
      let cnt = verified;
      if (o.business?.shareOfferRequiresPurchase) {
        if (!qmap.has(o.businessId)) qmap.set(o.businessId, await countQualifiedReferrals(customerId, o.businessId));
        cnt = qmap.get(o.businessId) ?? 0;
      }
      scored.push({ offer: o, left: sharesLeft(o, cnt) });
    }
    const candidates = scored
      // left=0 lo resuelve unlockShareChallengeOffers en el próximo referido;
      // aquí solo recordamos retos realmente a medias y bajo el tope.
      .filter((c) => c.left > 0 && remindersFor(c.offer.id) < MAX_PER_OFFER)
      .sort((a, b) => a.left - b.left || b.offer.discountPct - a.offer.discountPct);
    const best = candidates[0];
    if (!best) continue;

    const prize = best.offer.rewardLabel?.trim() || `${best.offer.discountPct}% de descuento`;
    const bizName = best.offer.business?.name ?? "el negocio";
    const daysLeft = Math.max(1, Math.ceil((best.offer.expiresAt.getTime() - now) / 86_400_000));
    const r = await notifyBubuiCustomer(customerId, {
      title: `🔥 Te ${best.left === 1 ? "falta 1 amigo" : `faltan ${best.left} amigos`} para tu premio`,
      body: `Tu ${prize} en ${bizName} te espera. Comparte tu enlace antes de ${daysLeft} día${daysLeft === 1 ? "" : "s"} y actívalo.`,
      link: "bubui://offers",
      tag: `share-reminder:${best.offer.id}`,
      data: { type: "share_offer_reminder", offerId: best.offer.id, businessId: best.offer.businessId }
    });
    if (r.sent > 0) {
      sent++;
      await prisma.bubuiPushLog
        .create({
          data: {
            customerId,
            kind: "share_reminder",
            payload: { offerId: best.offer.id, left: best.left, prize }
          }
        })
        .catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, lockedOffers: locked.length, customers: byCustomer.size, sent, expirySent, expiryDeferred });
}
