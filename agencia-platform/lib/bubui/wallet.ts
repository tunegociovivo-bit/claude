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
/**
 * Abona el % de la hucha al referidor por traer un amigo que se DA DE ALTA
 * (teléfono verificado). Es la única vía de premio por compartir: por cada amigo
 * que se instala/registra, +REFERRAL_REWARD_PCT. Renueva la caducidad global y
 * topa a 100%. Se llama desde applyReferral (una vez por amigo). Tolerante a
 * fallos. Devuelve el saldo resultante (o null si no abonó).
 */
export async function creditReferrerWallet(referrerId: string): Promise<number | null> {
  const expiresAt = new Date(Date.now() + WALLET_DAYS * 86_400_000);
  const updated = await prisma.bubuiCustomer
    .update({
      where: { id: referrerId },
      data: {
        referralWalletPct: { increment: REFERRAL_REWARD_PCT },
        referralQualifiedCount: { increment: 1 },
        referralWalletExpiresAt: expiresAt
      },
      select: { referralWalletPct: true }
    })
    .catch(() => null);
  if (!updated) return null;

  const capped = Math.min(updated.referralWalletPct, WALLET_MAX_PCT);
  if (updated.referralWalletPct > WALLET_MAX_PCT) {
    await prisma.bubuiCustomer
      .update({ where: { id: referrerId }, data: { referralWalletPct: WALLET_MAX_PCT } })
      .catch(() => {});
  }

  void notifyBubuiCustomer(referrerId, {
    title: `🎁 +${REFERRAL_REWARD_PCT}% en tu hucha Bubui`,
    body: `Un amigo se ha dado de alta con tu enlace. Tienes un ${capped}% acumulado para cobrar yendo a comer (caduca en ${WALLET_DAYS} días).`,
    link: "bubui://offers",
    tag: `wallet-credit:${referrerId}`,
    data: { type: "referral_wallet_credit", pct: capped }
  });
  return capped;
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
