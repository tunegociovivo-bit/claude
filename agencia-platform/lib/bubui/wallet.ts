/**
 * Hucha de referidos de Bubui.
 *
 * Cada cliente acumula un % de descuento por cada amigo que trae y que se
 * CUALIFICA (se da de alta + verifica teléfono + hace su 1ª compra confirmada).
 * Ese % se "cobra" yendo a comer (solo): al escanear se aplica hasta el tope por
 * visita del negocio (mesaMaxPct) y solo sobre los primeros WALLET_MAX_AMOUNT €
 * (anti-abuso de "vine con 10 personas"); el % consumido se descuenta y el resto
 * queda acumulado con su caducidad global corriendo.
 */
import { prisma } from "@/lib/db/prisma";
import { notifyBubuiCustomer } from "./notify";

/** % que gana el referidor por cada amigo cualificado. */
export const REFERRAL_REWARD_PCT = 1;
/** Tope del saldo acumulado (un "100% de descuento" como techo). */
export const WALLET_MAX_PCT = 100;
/** Caducidad global de la hucha (se renueva con cada abono). */
export const WALLET_DAYS = 90;
/** € máximos de la cuenta sobre los que aplica la hucha (anti-abuso de mesa grande). */
export const WALLET_MAX_AMOUNT = 50;

/** % de hucha efectivo ahora mismo (0 si caducó o está vacía). */
export function effectiveWalletPct(c: { referralWalletPct: number; referralWalletExpiresAt: Date | null }): number {
  if (!c.referralWalletPct || c.referralWalletPct <= 0) return 0;
  if (c.referralWalletExpiresAt && c.referralWalletExpiresAt.getTime() < Date.now()) return 0;
  return c.referralWalletPct;
}

/**
 * Cualifica a un amigo recién traído y abona % a su referidor. Cualificado =
 * tiene referidor + teléfono verificado + acaba de hacer una compra confirmada.
 * Idempotente: el flag referralQualified del amigo garantiza un solo abono.
 * Tolerante a fallos (no rompe el flujo de escaneo). Devuelve true si abonó.
 */
export async function qualifyAndCreditReferrer(friend: {
  id: string;
  referredById: string | null;
  phoneVerified: boolean;
  referralQualified: boolean;
}): Promise<boolean> {
  if (friend.referralQualified || !friend.referredById || !friend.phoneVerified) return false;
  // Reclama el flag de forma atómica (evita doble abono en carreras).
  const claim = await prisma.bubuiCustomer.updateMany({
    where: { id: friend.id, referralQualified: false },
    data: { referralQualified: true }
  });
  if (claim.count === 0) return false;

  const expiresAt = new Date(Date.now() + WALLET_DAYS * 86_400_000);
  const updated = await prisma.bubuiCustomer
    .update({
      where: { id: friend.referredById },
      data: {
        referralWalletPct: { increment: REFERRAL_REWARD_PCT },
        referralQualifiedCount: { increment: 1 },
        referralWalletExpiresAt: expiresAt
      },
      select: { referralWalletPct: true }
    })
    .catch(() => null);
  if (!updated) return false;

  // Tope del saldo a 100%.
  const capped = Math.min(updated.referralWalletPct, WALLET_MAX_PCT);
  if (updated.referralWalletPct > WALLET_MAX_PCT) {
    await prisma.bubuiCustomer
      .update({ where: { id: friend.referredById }, data: { referralWalletPct: WALLET_MAX_PCT } })
      .catch(() => {});
  }

  void notifyBubuiCustomer(friend.referredById, {
    title: `🎁 +${REFERRAL_REWARD_PCT}% en tu hucha Bubui`,
    body: `Un amigo tuyo ya es cliente. Tienes un ${capped}% acumulado para cobrar yendo a comer (caduca en ${WALLET_DAYS} días).`,
    link: "bubui://offers",
    tag: `wallet-credit:${friend.id}`,
    data: { type: "referral_wallet_credit", pct: capped }
  });
  return true;
}

/**
 * Calcula (sin mutar) cuánto aplicaría la hucha a una compra individual ("yendo
 * solo"): hasta maxPct (tope por visita del negocio) y solo sobre los primeros
 * WALLET_MAX_AMOUNT €. Devuelve el detalle o null si no hay saldo aplicable.
 * Útil para comparar con el descuento base antes de decidir cuál gana.
 */
export function computeWalletApplication(
  customer: { referralWalletPct: number; referralWalletExpiresAt: Date | null },
  amount: number,
  maxPct: number
): { appliedPct: number; remaining: number; eligibleAmount: number; discountAmount: number } | null {
  const wallet = effectiveWalletPct(customer);
  if (wallet <= 0) return null;
  const appliedPct = Math.min(wallet, Math.max(0, Math.round(maxPct)));
  if (appliedPct <= 0) return null;
  const eligibleAmount = Math.min(amount, WALLET_MAX_AMOUNT);
  const discountAmount = Math.round(eligibleAmount * appliedPct) / 100;
  return { appliedPct, remaining: Math.max(0, wallet - appliedPct), eligibleAmount, discountAmount };
}

/**
 * Consume el % aplicado de la hucha tras decidir que se usa. El resto queda
 * acumulado; si llega a 0 se limpia la caducidad. Tolerante a fallos.
 */
export async function consumeWallet(
  customer: { id: string; referralWalletExpiresAt: Date | null },
  remaining: number
): Promise<void> {
  await prisma.bubuiCustomer
    .update({
      where: { id: customer.id },
      data: {
        referralWalletPct: remaining,
        referralWalletExpiresAt: remaining > 0 ? customer.referralWalletExpiresAt : null
      }
    })
    .catch(() => {});
}
