import type { Prisma, BubuiPurchase } from "@prisma/client";
import { grantLoyaltyIfReached } from "./loyalty";

export class PurchaseConflict extends Error {}

/** The state transition, balance, coupon and rewards commit together.
 * updateMany is a compare-and-set: two simultaneous confirmations cannot both win.
 * Call only inside a database transaction. */
export async function settlePurchase(tx: Prisma.TransactionClient, purchase: BubuiPurchase) {
  const changed = await tx.bubuiPurchase.updateMany({
    where: { id: purchase.id, businessId: purchase.businessId, status: "pending" },
    data: { status: "confirmed", confirmedAt: new Date() }
  });
  if (!changed.count) return null;

  let redeemedOffer = null;
  if (purchase.redeemedOfferId) {
    const claimed = await tx.bubuiOffer.updateMany({
      where: {
        id: purchase.redeemedOfferId, customerId: purchase.customerId,
        businessId: purchase.businessId, redeemed: false, active: true,
        expiresAt: { gt: new Date() }
      },
      data: { redeemed: true, redeemedAt: new Date() }
    });
    if (!claimed.count) throw new PurchaseConflict("El cupón ha caducado o ya se ha utilizado.");
    redeemedOffer = await tx.bubuiOffer.findUnique({ where: { id: purchase.redeemedOfferId } });
  }
  if (purchase.walletPctUsed > 0) {
    const debited = await tx.bubuiCustomer.updateMany({
      where: {
        id: purchase.customerId, referralWalletPct: { gte: purchase.walletPctUsed },
        OR: [{ referralWalletExpiresAt: null }, { referralWalletExpiresAt: { gt: new Date() } }]
      },
      data: { referralWalletPct: { decrement: purchase.walletPctUsed } }
    });
    if (!debited.count) throw new PurchaseConflict("El saldo de la hucha ha cambiado. Revisa la compra.");
  }
  const customer = await tx.bubuiCustomer.update({
    where: { id: purchase.customerId },
    data: { totalPurchases: { increment: 1 }, totalSaved: { increment: purchase.discountAmount } }
  });
  const loyalty = await grantLoyaltyIfReached({ customerId: purchase.customerId, businessId: purchase.businessId }, tx);
  return { customer, redeemedOffer, loyalty };
}
