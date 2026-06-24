/**
 * Oferta-reto viral + reseñas de Google.
 *
 * Mecánica de crecimiento: al escanear el ticket, si el negocio la tiene
 * activada (shareOfferPct > 0), se crea una oferta MAYOR pero BLOQUEADA
 * (active=false). El cliente la desbloquea consiguiendo `shareOfferFriends`
 * amigos nuevos verificados (comparte su enlace de Bubui). Cuando un amigo se
 * verifica, applyReferral() llama a unlockShareChallengeOffers() y, si ya
 * llega al objetivo, la oferta se activa y se le avisa por push.
 */
import { prisma } from "@/lib/db/prisma";
import { countVerifiedReferrals, countQualifiedReferrals } from "./referral";
import { notifyBubuiCustomer } from "./notify";

/** URL del formulario de reseñas de Google con el local preseleccionado. */
export function googleReviewUrl(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
}


/** Amigos que faltan para desbloquear una oferta-reto, dado el recuento actual. */
export function sharesLeft(
  offer: { unlockBaseline: number; unlockShares: number },
  verifiedNow: number
): number {
  return Math.max(0, offer.unlockBaseline + offer.unlockShares - verifiedNow);
}

/**
 * Crea la oferta-reto bloqueada para una compra recién escaneada. Idempotente
 * por compra (triggerBusinessId = "share:<purchaseId>"). Devuelve la oferta
 * creada o null si el negocio no la tiene activada o ya existía.
 */
export async function createShareChallengeOffer(args: {
  customerId: string;
  business: {
    id: string;
    shareOfferPct: number;
    shareOfferFriends: number;
    shareOfferLabel: string | null;
    shareOfferRequiresPurchase?: boolean;
  };
  purchaseId: string;
}): Promise<{ discountPct: number; label: string | null; friends: number; expiresAt: Date } | null> {
  const { customerId, business, purchaseId } = args;
  if (!business.shareOfferPct || business.shareOfferPct <= 0) return null;
  const friends = Math.max(1, business.shareOfferFriends || 5);
  // El baseline (punto de partida) usa el MISMO criterio que el desbloqueo, para
  // que solo cuenten los amigos conseguidos a partir de esta compra.
  const baseline = business.shareOfferRequiresPurchase
    ? await countQualifiedReferrals(customerId, business.id)
    : await countVerifiedReferrals(customerId);
  const { getChallengeExpiryDays } = await import("./growth-settings");
  const days = await getChallengeExpiryDays();
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000); // caducidad configurable
  try {
    await prisma.bubuiOffer.create({
      data: {
        customerId,
        businessId: business.id,
        discountPct: business.shareOfferPct,
        rewardLabel: business.shareOfferLabel?.trim() || null,
        triggerBusinessId: `share:${purchaseId}`,
        source: "share_challenge",
        active: false,
        unlockShares: friends,
        unlockBaseline: baseline,
        expiresAt
      }
    });
    return { discountPct: business.shareOfferPct, label: business.shareOfferLabel?.trim() || null, friends, expiresAt };
  } catch {
    // P2002: ya existe la oferta-reto de esta compra. Silencioso.
    return null;
  }
}

/**
 * Reto de compartir de la Mesa Colectiva: cuando un comensal "comparte" en la
 * mesa, además del % de grupo inmediato (que cuenta sin verificar instalaciones),
 * se le crea una oferta-reto BLOQUEADA con el bonus de compartir. Se activa
 * cuando sus `friends` amigos se den de alta de verdad — reutiliza todo el motor
 * de oferta-reto (desbloqueo vía applyReferral + recordatorios del cron). Es el
 * "+% adicional si tus amigos se instalan" del diseño. Idempotente por
 * (sesión, comensal). Devuelve true si la creó.
 */
export async function createMesaShareChallenge(args: {
  customerId: string;
  sessionId: string;
  business: { id: string; mesaShareBonusPct: number };
  friends: number;
}): Promise<boolean> {
  const { customerId, sessionId, business, friends } = args;
  const pct = business.mesaShareBonusPct ?? 0;
  if (pct <= 0) return false;
  const baseline = await countVerifiedReferrals(customerId);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 días para activarla
  try {
    await prisma.bubuiOffer.create({
      data: {
        customerId,
        businessId: business.id,
        discountPct: pct,
        triggerBusinessId: `mesashare:${sessionId}:${customerId}`,
        source: "share_challenge",
        active: false,
        unlockShares: Math.max(1, friends),
        unlockBaseline: baseline,
        expiresAt
      }
    });
    return true;
  } catch {
    return false; // P2002: ya existe el reto de esta mesa para este comensal
  }
}

/**
 * Tras verificarse un amigo, activa las ofertas-reto del referidor cuyo
 * objetivo ya se haya alcanzado y le avisa por push. Devuelve cuántas
 * desbloqueó. Tolerante a fallos (no rompe el flujo de referidos).
 */
export async function unlockShareChallengeOffers(referrerId: string): Promise<number> {
  const locked = await prisma.bubuiOffer.findMany({
    where: {
      customerId: referrerId,
      source: "share_challenge",
      active: false,
      redeemed: false,
      expiresAt: { gt: new Date() }
    },
    include: { business: { select: { name: true, shareOfferRequiresPurchase: true } } }
  });
  if (locked.length === 0) return 0;

  const verified = await countVerifiedReferrals(referrerId);
  // Para los retos que exigen compra, recuento cacheado por negocio.
  const qualifiedByBiz = new Map<string, number>();
  let unlocked = 0;
  for (const offer of locked) {
    let current = verified;
    if (offer.business?.shareOfferRequiresPurchase) {
      if (!qualifiedByBiz.has(offer.businessId)) {
        qualifiedByBiz.set(offer.businessId, await countQualifiedReferrals(referrerId, offer.businessId));
      }
      current = qualifiedByBiz.get(offer.businessId) ?? 0;
    }
    if (sharesLeft(offer, current) > 0) continue;
    // Activa solo si seguía bloqueada (evita doble push en carreras).
    const res = await prisma.bubuiOffer.updateMany({
      where: { id: offer.id, active: false },
      data: { active: true }
    });
    if (res.count === 0) continue;
    unlocked++;
    const prize = offer.rewardLabel?.trim() || `${offer.discountPct}%`;
    void notifyBubuiCustomer(referrerId, {
      title: "🔓 ¡Oferta desbloqueada!",
      body: `Conseguiste tus amigos: ya puedes usar tu ${prize} en ${offer.business?.name ?? "el negocio"}.`,
      link: "bubui://offers",
      tag: `share-unlock:${offer.id}`,
      data: { type: "share_offer_unlocked", offerId: offer.id, businessId: offer.businessId }
    });
  }
  return unlocked;
}
