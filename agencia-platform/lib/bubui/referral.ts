/**
 * Programa de afiliados de Bubui.
 *
 * - Cada cliente tiene un referralCode para su enlace de invitación.
 * - Cuenta un referido cuando el amigo VERIFICA su teléfono.
 * - Hitos 1 / 3 / 5 amigos verificados → cupón de premio para el
 *   referidor, en su negocio de origen (firstBusinessId), que es quien
 *   financia y configura las recompensas.
 * - El amigo recibe un cupón de bienvenida al registrarse por el enlace.
 */

import { randomBytes } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { sendEmail, isEmailEnabled } from "@/lib/integrations/email";

export const MILESTONES = [1, 3, 5] as const;

const DEFAULT_REWARDS: Record<number, string> = {
  1: "2",
  3: "3",
  5: "5"
};

/** Interpreta la recompensa: si es un número (o "5%") → cupón de ese %
 *  guardado para otro día; si es texto → etiqueta (ej. "Tapa gratis"). */
export function parseReward(text: string): { discountPct: number; label: string | null } {
  const m = /^\s*(\d{1,2})\s*%?\s*$/.exec(text);
  if (m) return { discountPct: Math.min(90, Math.max(1, parseInt(m[1], 10))), label: null };
  return { discountPct: 0, label: text };
}

export function rewardLabelFor(
  business: { referralReward1: string | null; referralReward3: string | null; referralReward5: string | null } | null,
  n: number
): string {
  const map: Record<number, string | null | undefined> = {
    1: business?.referralReward1,
    3: business?.referralReward3,
    5: business?.referralReward5
  };
  return (map[n] && map[n]!.trim()) || DEFAULT_REWARDS[n] || "Recompensa Bubui";
}

/** Genera un código corto único (6 chars, sin caracteres ambiguos). */
export async function ensureReferralCode(customerId: string): Promise<string> {
  const existing = await prisma.bubuiCustomer.findUnique({ where: { id: customerId }, select: { referralCode: true } });
  if (existing?.referralCode) return existing.referralCode;
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 6; attempt++) {
    const buf = randomBytes(6);
    let code = "";
    for (let i = 0; i < 6; i++) code += alphabet[buf[i] % alphabet.length];
    try {
      await prisma.bubuiCustomer.update({ where: { id: customerId }, data: { referralCode: code } });
      return code;
    } catch {
      // colisión improbable → reintenta
    }
  }
  // fallback determinista
  const code = customerId.slice(-6).toUpperCase();
  await prisma.bubuiCustomer.update({ where: { id: customerId }, data: { referralCode: code } }).catch(() => {});
  return code;
}

export async function countVerifiedReferrals(referrerId: string): Promise<number> {
  return prisma.bubuiCustomer.count({ where: { referredById: referrerId, phoneVerified: true } });
}

export async function countOfferReferrals(referrerId: string, offerId: string): Promise<number> {
  return prisma.bubuiCustomer.count({
    where: { referredById: referrerId, referralOfferId: offerId, phoneVerified: true }
  });
}

export async function countQualifiedOfferReferrals(
  referrerId: string,
  offerId: string,
  businessId: string
): Promise<number> {
  const friends = await prisma.bubuiCustomer.findMany({
    where: { referredById: referrerId, referralOfferId: offerId, phoneVerified: true },
    select: { id: true }
  });
  if (friends.length === 0) return 0;
  const welcomeOffers = await prisma.bubuiOffer.findMany({
    where: {
      businessId,
      customerId: { in: friends.map((friend) => friend.id) },
      source: "referral_welcome"
    },
    select: { id: true }
  });
  if (welcomeOffers.length === 0) return 0;
  const redeemed = await prisma.bubuiPurchase.findMany({
    where: {
      status: "confirmed",
      redeemedOfferId: { in: welcomeOffers.map((welcome) => welcome.id) }
    },
    select: { redeemedOfferId: true },
    distinct: ["redeemedOfferId"]
  });
  return redeemed.length;
}

/**
 * Amigos referidos (verificados) que ADEMÁS han comprado (compra confirmada) en
 * un negocio concreto. Es el recuento para el reto cuando el comercio exige que
 * los amigos gasten su cupón (shareOfferRequiresPurchase).
 */
export async function countQualifiedReferrals(referrerId: string, businessId: string): Promise<number> {
  const friends = await prisma.bubuiCustomer.findMany({
    where: { referredById: referrerId, phoneVerified: true },
    select: { id: true }
  });
  if (friends.length === 0) return 0;
  const purchasers = await prisma.bubuiPurchase.findMany({
    where: { businessId, status: "confirmed", customerId: { in: friends.map((f) => f.id) } },
    select: { customerId: true },
    distinct: ["customerId"]
  });
  return purchasers.length;
}

/**
 * Avisa al negocio de que un cliente REFERIDO (lo invitó otro usuario de Bubui)
 * acaba de venir por PRIMERA vez a su local — la señal de valor que el comercio
 * quiere ver: "Bubui me está trayendo clientes nuevos". Se llama tras crear una
 * compra confirmada. Solo dispara en la 1ª compra del cliente en ese negocio.
 * Crea la notificación del panel y, si hay email configurado, avisa al dueño.
 * Tolerante a fallos.
 */
export async function notifyBusinessNewReferredClient(args: {
  businessId: string;
  customer: { id: string; name: string | null; referredById: string | null };
}): Promise<boolean> {
  const { businessId, customer } = args;
  if (!customer.referredById) return false;
  // ¿Es su PRIMERA compra confirmada en ESTE negocio? (el count incluye la recién
  // creada, así que 1 = primera vez aquí).
  const confirmedHere = await prisma.bubuiPurchase.count({
    where: { customerId: customer.id, businessId, status: "confirmed" }
  });
  if (confirmedHere !== 1) return false;

  const who = customer.name?.trim() || "Un cliente";
  const msg = `🎉 ${who} ha venido por primera vez gracias a Bubui (lo invitó otro cliente). La app te está trayendo clientes nuevos.`;
  await prisma.bubuiBusinessNotification
    .create({ data: { businessId, type: "referred_client", message: msg } })
    .catch(() => {});

  // Push al panel del negocio (si el dueño activó push Y quiere este aviso).
  void import("./business-push")
    .then(async (m) => {
      if (await m.businessWantsPush(businessId, "referred_client")) {
        await m.sendPushToBubuiBusiness(businessId, { title: "🎉 Cliente nuevo vía Bubui", body: msg, link: "/bubui/negocio", tag: "referred_client" });
      }
    })
    .catch(() => {});

  const biz = await prisma.bubuiBusiness.findUnique({
    where: { id: businessId },
    select: { name: true, ownerEmail: true }
  });
  if (biz?.ownerEmail && isEmailEnabled()) {
    sendEmail({
      to: biz.ownerEmail,
      subject: `Bubui · Nuevo cliente en ${biz.name} 🎉`,
      html: `<p>${msg}</p><p>Entra a tu panel Bubui para verlo.</p>`,
      text: msg
    }).catch(() => {});
  }
  return true;
}

/**
 * Datos de una invitación por código (para el preview rico del enlace
 * /bubui/r/<code> en WhatsApp): el negocio de origen y el % de bienvenida que
 * se llevará el amigo. null si el código no existe o no tiene negocio.
 */
export async function getReferralInvite(
  code: string
): Promise<{ businessName: string; city: string | null; welcomePct: number } | null> {
  const referrer = await prisma.bubuiCustomer.findUnique({
    where: { referralCode: code.toUpperCase() },
    select: { firstBusinessId: true }
  });
  if (!referrer?.firstBusinessId) return null;
  const business = await prisma.bubuiBusiness.findUnique({
    where: { id: referrer.firstBusinessId },
    select: { name: true, city: true, defaultDiscountPct: true, newCustomerDiscountPct: true, shareFriendDiscountPct: true, active: true }
  });
  if (!business || !business.active) return null;
  const welcomePct = business.shareFriendDiscountPct || business.newCustomerDiscountPct || business.defaultDiscountPct;
  return { businessName: business.name, city: business.city, welcomePct };
}

/** Resultado verificable de applyReferral: la app conserva el código
 *  pendiente hasta ver linked o terminal (los no-op definitivos no se
 *  reintentan; los transitorios sí). */
export type ApplyReferralResult = {
  linked: boolean; // el amigo queda (o ya estaba) vinculado a ESTE referidor
  terminal: boolean; // true = reintentar no puede mejorar el resultado
  reason: string;
  referrerId?: string;
  welcomeOfferCreated?: boolean;
};

/**
 * Vincula un amigo recién verificado a su referidor (por código) y aplica
 * recompensas: cupón de bienvenida al amigo + cupones de hito al referidor.
 * Idempotente y REPARATIVO: si el amigo ya estaba vinculado a este referidor
 * pero el cupón de bienvenida no llegó a crearse (fallo posterior), el
 * reintento repara el cupón en vez de salir por referredById.
 */
export async function applyReferral(friendId: string, code: string, offerId?: string): Promise<ApplyReferralResult> {
  const referrer = await prisma.bubuiCustomer.findUnique({
    where: { referralCode: code.toUpperCase() },
    select: { id: true, firstBusinessId: true }
  });
  if (!referrer) return { linked: false, terminal: true, reason: "invalid_code" };
  if (referrer.id === friendId) return { linked: false, terminal: true, reason: "self_referral" };

  const friend = await prisma.bubuiCustomer.findUnique({ where: { id: friendId }, select: { referredById: true } });
  if (!friend) return { linked: false, terminal: true, reason: "friend_not_found" };
  if (friend.referredById && friend.referredById !== referrer.id) {
    return { linked: false, terminal: true, reason: "already_referred_other", referrerId: friend.referredById };
  }

  let challenge: { id: string; businessId: string } | null = null;
  if (offerId) {
    challenge = await prisma.bubuiOffer.findFirst({
      where: {
        id: offerId,
        customerId: referrer.id,
        source: "share_challenge",
        redeemed: false,
        ...(friend.referredById === referrer.id ? {} : { expiresAt: { gt: new Date() } })
      },
      select: { id: true, businessId: true }
    });
    if (!challenge) {
      return { linked: false, terminal: friend.referredById !== referrer.id, reason: "invalid_challenge" };
    }
  }
  const newlyLinked = !friend.referredById;
  if (newlyLinked) {
    // updateMany con guard = link atómico (no pisa un vínculo concurrente).
    const upd = await prisma.bubuiCustomer.updateMany({
      where: { id: friendId, referredById: null },
      data: { referredById: referrer.id, ...(challenge ? { referralOfferId: challenge.id } : {}) }
    });
    if (upd.count === 0) {
      const again = await prisma.bubuiCustomer.findUnique({ where: { id: friendId }, select: { referredById: true } });
      if (again?.referredById !== referrer.id) {
        return { linked: false, terminal: true, reason: "already_referred_other", referrerId: again?.referredById ?? undefined };
      }
    }
  }
  if (challenge) {
    await prisma.bubuiCustomer.updateMany({
      where: { id: friendId, referredById: referrer.id, referralOfferId: null },
      data: { referralOfferId: challenge.id }
    });
  }

  // Hucha de referidos: solo en el vínculo nuevo (los reintentos reparan el
  // cupón, no duplican la hucha).
  if (newlyLinked) {
    await import("./wallet").then((m) => m.creditReferrerWallet(referrer.id)).catch(() => {});
  }

  // Negocio de origen: quien financia los premios. Si el referidor aún no
  // tiene firstBusinessId (p. ej. entró por un enlace de reto y algo impidió
  // fijarlo), usamos el negocio de su reto activo más reciente.
  let originId = challenge?.businessId ?? referrer.firstBusinessId;
  if (!originId) {
    const lastDeal = await prisma.bubuiCustomDeal.findFirst({
      where: { claimedByCustomerId: referrer.id, expiresAt: { gt: new Date() } },
      orderBy: { claimedAt: "desc" },
      select: { businessId: true }
    });
    originId = lastDeal?.businessId ?? null;
  }
  if (!originId) {
    // Aún no hay negocio de origen (p. ej. reclamará el reto después) →
    // transitorio: el reintento posterior podrá crear el cupón.
    return { linked: true, terminal: false, reason: "no_origin_yet", referrerId: referrer.id, welcomeOfferCreated: false };
  }
  const business = await prisma.bubuiBusiness.findUnique({ where: { id: originId } });
  if (!business || !business.referralEnabled) {
    return { linked: true, terminal: true, reason: "referrals_disabled", referrerId: referrer.id, welcomeOfferCreated: false };
  }

  const exp = new Date(Date.now() + 30 * 86_400_000);

  // Cupón de bienvenida para el amigo (en el negocio de origen). El comercio
  // configura este % en "Descuento para los amigos"; si es 0, usamos el de
  // cliente nuevo y, en su defecto, el descuento por defecto.
  // Si el referidor tiene un RETO PERSONALIZADO activo en este negocio, manda
  // el % de amigo de ese reto.
  const activeDeal = await prisma.bubuiCustomDeal.findFirst({
    where: { businessId: originId, claimedByCustomerId: referrer.id, ...(challenge ? { offerId: challenge.id } : {}), expiresAt: { gt: new Date() } },
    orderBy: { claimedAt: "desc" },
    select: { friendDiscountPct: true }
  });
  const friendPct =
    (activeDeal && activeDeal.friendDiscountPct > 0 ? activeDeal.friendDiscountPct : 0) ||
    business.shareFriendDiscountPct ||
    business.newCustomerDiscountPct ||
    business.defaultDiscountPct;
  let welcomeOfferCreated = false;
  try {
    await prisma.bubuiOffer.create({
      data: {
        customerId: friendId,
        businessId: originId,
        discountPct: friendPct,
        // Una sola bienvenida por amigo+negocio, venga del enlace genérico o
        // del reto. Reabrir/cambiar de formato nunca puede crear un 2º cupón.
        triggerBusinessId: "ref:welcome",
        source: "referral_welcome",
        expiresAt: exp
      }
    });
    welcomeOfferCreated = true;
  } catch (e: any) {
    if (e?.code === "P2002") {
      welcomeOfferCreated = true; // ya existía de un intento anterior
    } else {
      console.error("[applyReferral] cupón de bienvenida falló:", e?.message);
      // Transitorio: conservar linked pero NO terminal → la app reintenta.
      return { linked: true, terminal: false, reason: "welcome_offer_failed", referrerId: referrer.id, welcomeOfferCreated: false };
    }
  }

  // Recompensas de hito para el referidor.
  const count = await countVerifiedReferrals(referrer.id);
  const newlyReached: number[] = [];
  for (const m of MILESTONES) {
    if (count >= m) {
      const { discountPct, label } = parseReward(rewardLabelFor(business, m));
      try {
        await prisma.bubuiOffer.create({
          data: {
            customerId: referrer.id,
            businessId: originId,
            discountPct,
            rewardLabel: label,
            triggerBusinessId: `ref:${m}`,
            source: "referral",
            expiresAt: exp
          }
        });
        newlyReached.push(m); // create OK = hito recién alcanzado
      } catch {
        // P2002 → ya otorgado, no es nuevo
      }
    }
  }

  // Aviso al dueño por cada hito recién alcanzado (panel siempre; email al
  // llegar a 5, el hito grande).
  if (newlyReached.length > 0) {
    const referrerInfo = await prisma.bubuiCustomer.findUnique({
      where: { id: referrer.id },
      select: { name: true, phone: true }
    });
    const who = referrerInfo?.name || "Un cliente";
    for (const m of newlyReached) {
      const msg = `🎁 ${who} ha traído ${m} ${m === 1 ? "amigo" : "amigos"} a ${business.name} con su enlace de afiliado.${m >= 5 ? " ¡Hito de 5 alcanzado!" : ""}`;
      await prisma.bubuiBusinessNotification
        .create({ data: { businessId: originId, type: "referral_milestone", message: msg } })
        .catch(() => {});
      if (m >= 5 && business.ownerEmail && isEmailEnabled()) {
        sendEmail({
          to: business.ownerEmail,
          subject: `Bubui · ${who} ha traído 5 amigos a ${business.name}`,
          html: `<p>${msg}</p><p>Entra a tu panel Bubui para ver el detalle.</p>`,
          text: msg
        }).catch(() => {});
      }
    }
  }

  // Oferta-reto viral: este nuevo amigo puede haber completado el reto de
  // alguna oferta bloqueada del referidor → se activa y se le avisa por push.
  await import("./share-offer")
    .then((m) => m.unlockShareChallengeOffers(referrer.id, challenge?.id))
    .catch(() => {});

  return {
    linked: true,
    terminal: true,
    reason: newlyLinked ? "linked" : "repaired",
    referrerId: referrer.id,
    welcomeOfferCreated
  };
}
