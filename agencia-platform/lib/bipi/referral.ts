/**
 * Programa de afiliados de Bipi.
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

export const MILESTONES = [1, 3, 5] as const;

const DEFAULT_REWARDS: Record<number, string> = {
  1: "5% de descuento extra",
  3: "10% de descuento",
  5: "Tapa o postre gratis"
};

export function rewardLabelFor(
  business: { referralReward1: string | null; referralReward3: string | null; referralReward5: string | null } | null,
  n: number
): string {
  const map: Record<number, string | null | undefined> = {
    1: business?.referralReward1,
    3: business?.referralReward3,
    5: business?.referralReward5
  };
  return (map[n] && map[n]!.trim()) || DEFAULT_REWARDS[n] || "Recompensa Bipi";
}

/** Genera un código corto único (6 chars, sin caracteres ambiguos). */
export async function ensureReferralCode(customerId: string): Promise<string> {
  const existing = await prisma.bipiCustomer.findUnique({ where: { id: customerId }, select: { referralCode: true } });
  if (existing?.referralCode) return existing.referralCode;
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 6; attempt++) {
    const buf = randomBytes(6);
    let code = "";
    for (let i = 0; i < 6; i++) code += alphabet[buf[i] % alphabet.length];
    try {
      await prisma.bipiCustomer.update({ where: { id: customerId }, data: { referralCode: code } });
      return code;
    } catch {
      // colisión improbable → reintenta
    }
  }
  // fallback determinista
  const code = customerId.slice(-6).toUpperCase();
  await prisma.bipiCustomer.update({ where: { id: customerId }, data: { referralCode: code } }).catch(() => {});
  return code;
}

export async function countVerifiedReferrals(referrerId: string): Promise<number> {
  return prisma.bipiCustomer.count({ where: { referredById: referrerId, phoneVerified: true } });
}

/**
 * Vincula un amigo recién verificado a su referidor (por código) y aplica
 * recompensas: cupón de bienvenida al amigo + cupones de hito al referidor.
 * Es idempotente (no duplica premios).
 */
export async function applyReferral(friendId: string, code: string): Promise<void> {
  const referrer = await prisma.bipiCustomer.findUnique({
    where: { referralCode: code.toUpperCase() },
    select: { id: true, firstBusinessId: true }
  });
  if (!referrer || referrer.id === friendId) return;

  // Vincula (solo si el amigo aún no tenía referidor).
  const friend = await prisma.bipiCustomer.findUnique({ where: { id: friendId }, select: { referredById: true } });
  if (friend?.referredById) return; // ya estaba referido
  await prisma.bipiCustomer.update({ where: { id: friendId }, data: { referredById: referrer.id } });

  const originId = referrer.firstBusinessId;
  if (!originId) return; // sin negocio de origen no hay quien financie premios
  const business = await prisma.bipiBusiness.findUnique({ where: { id: originId } });
  if (!business || !business.referralEnabled) return;

  const exp = new Date(Date.now() + 30 * 86_400_000);

  // Cupón de bienvenida para el amigo (en el negocio de origen).
  await prisma.bipiOffer
    .create({
      data: {
        customerId: friendId,
        businessId: originId,
        discountPct: business.defaultDiscountPct,
        triggerBusinessId: "ref:welcome",
        source: "referral_welcome",
        expiresAt: exp
      }
    })
    .catch(() => {});

  // Recompensas de hito para el referidor.
  const count = await countVerifiedReferrals(referrer.id);
  for (const m of MILESTONES) {
    if (count >= m) {
      await prisma.bipiOffer
        .create({
          data: {
            customerId: referrer.id,
            businessId: originId,
            discountPct: 0,
            rewardLabel: rewardLabelFor(business, m),
            triggerBusinessId: `ref:${m}`,
            source: "referral",
            expiresAt: exp
          }
        })
        .catch(() => {}); // unique → ya otorgado
    }
  }
}
